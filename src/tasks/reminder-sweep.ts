import type { DiscordPort } from '../core/discord-port.js'
import { resolveGuildConfig, type ResolvedGuildConfig } from '../core/guild-config.js'
import type { GuildConfigRepository } from '../db/guild-config-repository.js'
import type { OnboardingRepository } from '../db/onboarding-repository.js'
import { isOk, type OnboardingRecord } from '../types.js'

export const FIRST_REMINDER_MS = 24 * 60 * 60 * 1000
export const SECOND_REMINDER_MS = 72 * 60 * 60 * 1000

export type GuildSweepDeps = {
	readonly repo: OnboardingRepository
	readonly port: DiscordPort
	readonly now: () => Date
}

export type SweepDeps = GuildSweepDeps & {
	readonly guildConfig: GuildConfigRepository
}

const outstandingSteps = (record: OnboardingRecord, config: ResolvedGuildConfig): string[] => {
	const steps: string[] = []
	if (!record.rulesAcceptedAt) steps.push(`agree to the rules in <#${config.rulesChannelId}>`)
	if (!record.questionnaireCompletedAt) steps.push('finish the questionnaire with `/intro`')
	if (!record.introPostedAt) steps.push(`introduce yourself in <#${config.introductionsChannelId}>`)
	return steps
}

export const runGuildReminderSweep = async (
	deps: GuildSweepDeps,
	config: ResolvedGuildConfig
): Promise<number> => {
	const now = deps.now()
	const due = deps.repo.listAwaitingReminder(
		config.guildId,
		now.getTime(),
		FIRST_REMINDER_MS,
		SECOND_REMINDER_MS
	)

	let sent = 0

	for (const record of due) {
		const steps = outstandingSteps(record, config)

		// The counter advances in every branch. A member with closed DMs — or one
		// whose steps are all done but whose grant failed — would otherwise be
		// reselected by every future sweep, forever.
		if (steps.length > 0) {
			await deps.port.sendDm(record.userId, {
				title: `Finish setting up your access`,
				body: `You still need to:\n${steps.map((step) => `• ${step}`).join('\n')}`
			})
			sent += 1
		}

		deps.repo.incrementReminder(config.guildId, record.userId, now.toISOString())
	}

	return sent
}

export const runReminderSweep = async (deps: SweepDeps): Promise<number> => {
	let total = 0

	for (const row of deps.guildConfig.listEnabled()) {
		const resolved = resolveGuildConfig(row)
		if (!isOk(resolved)) continue

		// One guild's failure must not stop the rest.
		try {
			total += await runGuildReminderSweep(deps, resolved.value)
		} catch (error) {
			console.error(
				JSON.stringify({
					level: 'error',
					event: 'guild-sweep-failed',
					guildId: row.guildId,
					error: error instanceof Error ? error.message : String(error)
				})
			)
		}
	}

	if (total > 0)
		console.info(JSON.stringify({ level: 'info', event: 'reminder-sweep', sent: total }))

	return total
}
