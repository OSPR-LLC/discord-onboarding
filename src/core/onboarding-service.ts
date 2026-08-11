import type { OnboardingRepository } from '../db/onboarding-repository.js'
import type { Metrics } from '../observability/metrics.js'
import type { OnboardingRecord, OnboardingStep } from '../types.js'
import type { DiscordPort } from './discord-port.js'
import { evaluateGate, type GateDecision } from './gate.js'
import type { ResolvedGuildConfig } from './guild-config.js'

export type ServiceDeps = {
	readonly repo: OnboardingRepository
	readonly port: DiscordPort
	readonly now: () => string
	readonly metrics?: Metrics
}

export const isGrandfathered = (config: ResolvedGuildConfig, joinedAtMs: number): boolean =>
	config.grandfatherBefore !== null && joinedAtMs < Date.parse(config.grandfatherBefore)

export const createOnboardingService = (deps: ServiceDeps) => {
	const { repo, port, now, metrics } = deps

	const applyUnverified = async (config: ResolvedGuildConfig, userId: string): Promise<void> => {
		await port.addRole(config.guildId, userId, config.unverifiedRoleId)
		await port.removeRole(config.guildId, userId, config.verifiedRoleId)
	}

	const grantVerified = async (
		config: ResolvedGuildConfig,
		record: OnboardingRecord
	): Promise<void> => {
		// The role is applied before the record is stamped. If Discord rejects the
		// change, the member stays unverified and the next event retries, rather
		// than the database claiming success the server never saw.
		const added = await port.addRole(config.guildId, record.userId, config.verifiedRoleId)
		if (!added.ok) {
			await port.postAudit(config.guildId, config.modLogChannelId, {
				kind: 'verified',
				userId: record.userId,
				detail: `Could not add the verified role: ${added.error}`
			})
			return
		}

		repo.markVerified(config.guildId, record.userId, now())
		metrics?.increment('verified')
		await port.removeRole(config.guildId, record.userId, config.unverifiedRoleId)

		const answers = repo.getAnswers(config.guildId, record.userId)
		await port.postAudit(config.guildId, config.modLogChannelId, {
			kind: 'verified',
			userId: record.userId,
			detail: answers
				? `purpose="${answers.purpose ?? ''}" · experience=${answers.experienceLevel ?? 'unknown'} · builtForDiscord=${String(answers.builtForDiscord)}`
				: 'verified with no stored answers'
		})

		await port.sendDm(record.userId, {
			title: 'You are verified',
			body: 'Thanks for completing onboarding — the rest of the server is now open to you.'
		})
	}

	const recordStep = async (
		config: ResolvedGuildConfig,
		userId: string,
		step: OnboardingStep
	): Promise<GateDecision> => {
		const at = now()
		// Upsert first: a member can reach a step without the bot having seen
		// their join (bot offline, or a mod command touching a stranger).
		repo.upsertOnJoin(config.guildId, userId, at)
		repo.stampStep(config.guildId, userId, step, at)

		const record = repo.get(config.guildId, userId)
		if (!record) return 'incomplete'

		const decision = evaluateGate(record)
		if (decision === 'grant') await grantVerified(config, record)
		return decision
	}

	return {
		recordStep,
		grantVerified,

		handleJoin: async (
			config: ResolvedGuildConfig,
			userId: string,
			joinedAtMs: number
		): Promise<void> => {
			if (isGrandfathered(config, joinedAtMs)) return

			repo.upsertOnJoin(config.guildId, userId, now())
			const record = repo.get(config.guildId, userId)
			if (!record) return

			if (record.verifiedAt && !record.verificationHoldAt) {
				await port.addRole(config.guildId, userId, config.verifiedRoleId)
				return
			}

			await applyUnverified(config, userId)
		},

		applyHold: async (
			config: ResolvedGuildConfig,
			userId: string,
			actorId: string
		): Promise<void> => {
			const at = now()
			repo.upsertOnJoin(config.guildId, userId, at)
			repo.setHold(config.guildId, userId, at, actorId)

			await applyUnverified(config, userId)
			await port.postAudit(config.guildId, config.modLogChannelId, {
				kind: 'mod-action',
				userId,
				actorId,
				detail: 'verification hold applied'
			})
		},

		liftHoldAndVerify: async (
			config: ResolvedGuildConfig,
			userId: string,
			actorId: string
		): Promise<void> => {
			const at = now()
			repo.upsertOnJoin(config.guildId, userId, at)
			repo.clearHold(config.guildId, userId)
			for (const step of ['rules', 'questionnaire', 'intro'] as const)
				repo.stampStep(config.guildId, userId, step, at)

			const record = repo.get(config.guildId, userId)
			if (!record) return

			await grantVerified(config, record)
			await port.postAudit(config.guildId, config.modLogChannelId, {
				kind: 'mod-action',
				userId,
				actorId,
				detail: 'manually verified'
			})
		},

		resetMember: async (config: ResolvedGuildConfig, userId: string): Promise<void> => {
			repo.remove(config.guildId, userId)
			await applyUnverified(config, userId)
		}
	}
}

export type OnboardingService = ReturnType<typeof createOnboardingService>
