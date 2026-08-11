---
plan: verification-gate
project: discord-developer
updated: 2026-08-10
status: 🟡 In Progress
tags: [plan]
---

# 03 — Verification gate flow

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md`](../docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md)

## Status

🟡 In Progress

## Goal

> In any enabled guild, a member who joins after the guild was enabled receives `unverified`, accepts the rules from the posted message, answers three questions, posts in the introductions channel, and is automatically granted `verified`. Members who joined before the guild was enabled are never touched. Drift accumulated while the bot was offline is repaired on the next boot.

## Global Constraints

Inherits every constraint from [[01-bot-foundation]] and [[02-guild-configuration]]. Additionally:

- `src/core/` must never import `discord.js`.
- Every handler resolves guild config first and returns early if the guild is unconfigured or disabled.
- **Grandfathered members are never given `unverified`,** in any code path.
- Every path that could complete onboarding calls `evaluateGate` — no handler decides on its own whether to grant a role.
- All timestamps come from an injected `now()`.

## File Structure

| File                                       | Responsibility                                   |
| ------------------------------------------ | ------------------------------------------------ |
| `src/core/gate.ts`                         | `evaluateGate` — the single decision function    |
| `src/core/discord-port.ts`                 | `DiscordPort` interface and error types          |
| `src/core/onboarding-service.ts`           | Record a step, evaluate, emit effects            |
| `src/discord/port.ts`                      | Real `DiscordPort` backed by discord.js          |
| `src/discord/components/questionnaire.ts`  | Modal, select menu, yes/no buttons               |
| `src/discord/commands/intro.ts`            | `/intro` and the shared question prompter        |
| `src/discord/events/guild-member-add.ts`   | Join handling, grandfather check, rejoin restore |
| `src/discord/events/message-create.ts`     | Introductions channel watcher                    |
| `src/discord/events/interaction-create.ts` | Routes every interaction                         |
| `src/tasks/reconcile.ts`                   | Startup drift repair, per guild                  |

---

### Task 1: The gate

**Files:**

- Create: `src/core/gate.ts`
- Test: `tests/core/gate.test.ts`

**Interfaces:**

- Consumes: `OnboardingRecord`.
- Produces: `evaluateGate(record): GateDecision` where `GateDecision = 'grant' | 'already-verified' | 'held' | 'incomplete'`.

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { evaluateGate } from '../../src/core/gate.js'
import type { OnboardingRecord } from '../../src/types.js'

const AT = '2026-08-10T11:00:00.000Z'

const baseRecord: OnboardingRecord = {
	guildId: 'g1',
	userId: 'u1',
	firstJoinedAt: AT,
	lastJoinedAt: AT,
	rulesAcceptedAt: null,
	questionnaireCompletedAt: null,
	introPostedAt: null,
	introMessageId: null,
	verifiedAt: null,
	verificationHoldAt: null,
	verificationHoldBy: null,
	remindersSent: 0,
	lastReminderAt: null
}

const allSteps = { rulesAcceptedAt: AT, questionnaireCompletedAt: AT, introPostedAt: AT }

describe('evaluateGate', () => {
	it('returns incomplete when no steps are done', () => {
		expect(evaluateGate(baseRecord)).toBe('incomplete')
	})

	it.each([
		['only rules', { rulesAcceptedAt: AT }],
		['only questionnaire', { questionnaireCompletedAt: AT }],
		['only intro', { introPostedAt: AT }],
		['rules and questionnaire', { rulesAcceptedAt: AT, questionnaireCompletedAt: AT }],
		['rules and intro', { rulesAcceptedAt: AT, introPostedAt: AT }],
		['questionnaire and intro', { questionnaireCompletedAt: AT, introPostedAt: AT }]
	])('returns incomplete with %s done', (_label, steps) => {
		expect(evaluateGate({ ...baseRecord, ...steps })).toBe('incomplete')
	})

	it('returns grant when all three steps are done', () => {
		expect(evaluateGate({ ...baseRecord, ...allSteps })).toBe('grant')
	})

	it('returns already-verified when the member is verified', () => {
		expect(evaluateGate({ ...baseRecord, ...allSteps, verifiedAt: AT })).toBe('already-verified')
	})

	it('returns held for a held member even when every step is complete', () => {
		expect(evaluateGate({ ...baseRecord, ...allSteps, verificationHoldAt: AT })).toBe('held')
	})

	it('prefers held over already-verified so unverify cannot be undone by a later event', () => {
		expect(
			evaluateGate({ ...baseRecord, ...allSteps, verifiedAt: AT, verificationHoldAt: AT })
		).toBe('held')
	})
})
```

- [x] **Step 2: Run it to confirm it fails**

Run: `pnpm test tests/core/gate.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Write `src/core/gate.ts`**

```ts
import type { OnboardingRecord } from '../types.js'

export type GateDecision = 'grant' | 'already-verified' | 'held' | 'incomplete'

export const evaluateGate = (record: OnboardingRecord): GateDecision => {
	if (record.verificationHoldAt) return 'held'
	if (record.verifiedAt) return 'already-verified'
	if (record.rulesAcceptedAt && record.questionnaireCompletedAt && record.introPostedAt)
		return 'grant'
	return 'incomplete'
}
```

- [x] **Step 4: Run the test to confirm it passes**

Run: `pnpm test tests/core/gate.test.ts`
Expected: PASS, 11 tests.

- [x] **Step 5: Commit**

```bash
git add src/core/gate.ts tests/core/gate.test.ts
git commit -m "feat: add verification gate decision function"
```

---

### Task 2: DiscordPort and test fake

**Files:**

- Create: `src/core/discord-port.ts`, `tests/helpers/fake-discord-port.ts`

**Interfaces:**

- Produces: `DiscordPort` (every method takes `guildId`), `RoleError`, `DmError`, `ChannelError`, `AuditEntry`, `DmContent`, and `createFakeDiscordPort()` exposing `{ port, addedRoles, removedRoles, dms, audits, failDmFor, failRoleFor }`.

- [x] **Step 1: Write `src/core/discord-port.ts`**

```ts
import type { Result } from '../types.js'

export type RoleError = 'member-not-found' | 'role-not-found' | 'missing-permission' | 'unknown'
export type DmError = 'dms-closed' | 'member-not-found' | 'unknown'
export type ChannelError = 'channel-not-found' | 'missing-permission' | 'unknown'

export type DmContent = { readonly title: string; readonly body: string }

export type AuditEntry = {
	readonly kind: 'verified' | 'mod-action' | 'reconcile-anomaly'
	readonly userId: string
	readonly detail: string
	readonly actorId?: string
}

export type DiscordPort = {
	addRole: (guildId: string, userId: string, roleId: string) => Promise<Result<void, RoleError>>
	removeRole: (guildId: string, userId: string, roleId: string) => Promise<Result<void, RoleError>>
	sendDm: (userId: string, content: DmContent) => Promise<Result<void, DmError>>
	postAudit: (
		guildId: string,
		channelId: string,
		entry: AuditEntry
	) => Promise<Result<void, ChannelError>>
}
```

- [x] **Step 2: Write `tests/helpers/fake-discord-port.ts`**

```ts
import type { AuditEntry, DiscordPort, DmContent } from '../../src/core/discord-port.js'
import { err, ok } from '../../src/types.js'

type RoleCall = { guildId: string; userId: string; roleId: string }

export const createFakeDiscordPort = () => {
	const addedRoles: RoleCall[] = []
	const removedRoles: RoleCall[] = []
	const dms: { userId: string; content: DmContent }[] = []
	const audits: AuditEntry[] = []
	const dmFailures = new Set<string>()
	const roleFailures = new Set<string>()

	const port: DiscordPort = {
		addRole: async (guildId, userId, roleId) => {
			if (roleFailures.has(userId)) return err('missing-permission')
			addedRoles.push({ guildId, userId, roleId })
			return ok(undefined)
		},
		removeRole: async (guildId, userId, roleId) => {
			removedRoles.push({ guildId, userId, roleId })
			return ok(undefined)
		},
		sendDm: async (userId, content) => {
			if (dmFailures.has(userId)) return err('dms-closed')
			dms.push({ userId, content })
			return ok(undefined)
		},
		postAudit: async (_guildId, _channelId, entry) => {
			audits.push(entry)
			return ok(undefined)
		}
	}

	return {
		port,
		addedRoles,
		removedRoles,
		dms,
		audits,
		failDmFor: (userId: string) => dmFailures.add(userId),
		failRoleFor: (userId: string) => roleFailures.add(userId)
	}
}
```

- [x] **Step 3: Verify it compiles**

Run: `pnpm typecheck`
Expected: no errors.

- [x] **Step 4: Commit**

```bash
git add src/core/discord-port.ts tests/helpers/fake-discord-port.ts
git commit -m "feat: add guild-aware DiscordPort interface and test fake"
```

---

### Task 3: Onboarding service

**Files:**

- Create: `src/core/onboarding-service.ts`
- Test: `tests/core/onboarding-service.test.ts`

**Interfaces:**

- Consumes: `OnboardingRepository`, `DiscordPort`, `evaluateGate`, `ResolvedGuildConfig`.
- Produces: `createOnboardingService(deps): OnboardingService` with
  `recordStep(config, userId, step)`, `handleJoin(config, userId, joinedAtMs)`,
  `grantVerified(config, record)`, `applyHold(config, userId, actorId)`,
  `liftHoldAndVerify(config, userId, actorId)`, `resetMember(config, userId)`.
  `deps` is `{ repo, port, now }`. **Every method takes the `ResolvedGuildConfig`** rather than raw ids, so a half-configured guild cannot reach the service.
- Plan 04's mod commands call `applyHold`, `liftHoldAndVerify` and `resetMember`.

- [x] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { ResolvedGuildConfig } from '../../src/core/guild-config.js'
import { createOnboardingService } from '../../src/core/onboarding-service.js'
import { createOnboardingRepository } from '../../src/db/onboarding-repository.js'
import { EXPERIENCE_LEVELS } from '../../src/types.js'
import { createFakeDiscordPort } from '../helpers/fake-discord-port.js'
import { createTestDb } from '../helpers/test-db.js'

const GUILD = '123456789012345678'
const USER = '223456789012345678'
const MOD = '323456789012345678'
const VERIFIED = '423456789012345678'
const UNVERIFIED = '523456789012345678'

const CLOCK = '2026-08-10T12:00:00.000Z'
const ENABLED_AT = '2026-08-10T00:00:00.000Z'
const JOINED_AFTER = Date.parse('2026-08-10T06:00:00.000Z')
const JOINED_BEFORE = Date.parse('2026-08-01T00:00:00.000Z')

const config: ResolvedGuildConfig = {
	guildId: GUILD,
	rulesChannelId: '1',
	introductionsChannelId: '2',
	modLogChannelId: '3',
	verifiedRoleId: VERIFIED,
	unverifiedRoleId: UNVERIFIED,
	rulesText: 'Be nice.',
	rulesMessageId: null,
	grandfatherBefore: ENABLED_AT
}

let repo: ReturnType<typeof createOnboardingRepository>
let fake: ReturnType<typeof createFakeDiscordPort>
let service: ReturnType<typeof createOnboardingService>

beforeEach(() => {
	repo = createOnboardingRepository(createTestDb())
	fake = createFakeDiscordPort()
	service = createOnboardingService({ repo, port: fake.port, now: () => CLOCK })
})

const completeAllSteps = async () => {
	await service.recordStep(config, USER, 'rules')
	repo.saveAnswer(GUILD, USER, { purpose: 'learning' }, CLOCK)
	repo.saveAnswer(GUILD, USER, { experienceLevel: EXPERIENCE_LEVELS.SOME }, CLOCK)
	repo.saveAnswer(GUILD, USER, { builtForDiscord: false }, CLOCK)
	await service.recordStep(config, USER, 'questionnaire')
	return service.recordStep(config, USER, 'intro')
}

describe('handleJoin', () => {
	it('applies unverified to a member who joined after the guild was enabled', async () => {
		await service.handleJoin(config, USER, JOINED_AFTER)
		expect(fake.addedRoles).toContainEqual({ guildId: GUILD, userId: USER, roleId: UNVERIFIED })
	})

	it('completely ignores a member who joined before the guild was enabled', async () => {
		await service.handleJoin(config, USER, JOINED_BEFORE)
		expect(fake.addedRoles).toHaveLength(0)
		expect(repo.get(GUILD, USER)).toBeNull()
	})

	it('applies unverified to everyone when no grandfather cutoff is set', async () => {
		await service.handleJoin({ ...config, grandfatherBefore: null }, USER, JOINED_BEFORE)
		expect(fake.addedRoles).toContainEqual({ guildId: GUILD, userId: USER, roleId: UNVERIFIED })
	})

	it('restores verified without re-running the flow for a returning verified member', async () => {
		await service.handleJoin(config, USER, JOINED_AFTER)
		await completeAllSteps()
		fake.addedRoles.length = 0

		await service.handleJoin(config, USER, JOINED_AFTER)

		expect(fake.addedRoles).toContainEqual({ guildId: GUILD, userId: USER, roleId: VERIFIED })
		expect(fake.addedRoles).not.toContainEqual({ guildId: GUILD, userId: USER, roleId: UNVERIFIED })
	})

	it('does not restore verified for a returning member under a hold', async () => {
		await service.handleJoin(config, USER, JOINED_AFTER)
		await completeAllSteps()
		await service.applyHold(config, USER, MOD)
		fake.addedRoles.length = 0

		await service.handleJoin(config, USER, JOINED_AFTER)

		expect(fake.addedRoles).toContainEqual({ guildId: GUILD, userId: USER, roleId: UNVERIFIED })
		expect(fake.addedRoles).not.toContainEqual({ guildId: GUILD, userId: USER, roleId: VERIFIED })
	})
})

describe('recordStep', () => {
	beforeEach(() => service.handleJoin(config, USER, JOINED_AFTER))

	it('reports incomplete until all three steps are done', async () => {
		expect(await service.recordStep(config, USER, 'rules')).toBe('incomplete')
		expect(await service.recordStep(config, USER, 'intro')).toBe('incomplete')
	})

	it('grants verified and removes unverified once every step is done', async () => {
		expect(await completeAllSteps()).toBe('grant')
		expect(fake.addedRoles).toContainEqual({ guildId: GUILD, userId: USER, roleId: VERIFIED })
		expect(fake.removedRoles).toContainEqual({ guildId: GUILD, userId: USER, roleId: UNVERIFIED })
		expect(repo.get(GUILD, USER)?.verifiedAt).toBe(CLOCK)
	})

	it('accepts steps in any order', async () => {
		await service.recordStep(config, USER, 'intro')
		repo.saveAnswer(GUILD, USER, { purpose: 'p' }, CLOCK)
		repo.saveAnswer(GUILD, USER, { experienceLevel: EXPERIENCE_LEVELS.NEW }, CLOCK)
		repo.saveAnswer(GUILD, USER, { builtForDiscord: true }, CLOCK)
		await service.recordStep(config, USER, 'questionnaire')
		expect(await service.recordStep(config, USER, 'rules')).toBe('grant')
	})

	it('writes an audit entry when a member is verified', async () => {
		await completeAllSteps()
		expect(fake.audits.some((entry) => entry.kind === 'verified' && entry.userId === USER)).toBe(
			true
		)
	})

	it('still grants the role when the welcome DM fails', async () => {
		fake.failDmFor(USER)
		expect(await completeAllSteps()).toBe('grant')
		expect(fake.addedRoles).toContainEqual({ guildId: GUILD, userId: USER, roleId: VERIFIED })
	})

	it('does not mark the member verified when the role assignment fails', async () => {
		fake.failRoleFor(USER)
		await completeAllSteps()
		expect(repo.get(GUILD, USER)?.verifiedAt).toBeNull()
	})

	it('creates a record for a member it has never seen rather than doing nothing', async () => {
		const stranger = '723456789012345678'
		expect(await service.recordStep(config, stranger, 'rules')).toBe('incomplete')
		expect(repo.get(GUILD, stranger)?.rulesAcceptedAt).toBe(CLOCK)
	})
})

describe('applyHold', () => {
	beforeEach(async () => {
		await service.handleJoin(config, USER, JOINED_AFTER)
		await completeAllSteps()
	})

	it('removes verified and re-applies unverified', async () => {
		await service.applyHold(config, USER, MOD)
		expect(fake.removedRoles).toContainEqual({ guildId: GUILD, userId: USER, roleId: VERIFIED })
		expect(fake.addedRoles).toContainEqual({ guildId: GUILD, userId: USER, roleId: UNVERIFIED })
	})

	it('keeps the member unverified even when a further step fires', async () => {
		await service.applyHold(config, USER, MOD)
		fake.addedRoles.length = 0
		expect(await service.recordStep(config, USER, 'rules')).toBe('held')
		expect(fake.addedRoles).not.toContainEqual({ guildId: GUILD, userId: USER, roleId: VERIFIED })
	})

	it('records the acting moderator', async () => {
		await service.applyHold(config, USER, MOD)
		expect(repo.get(GUILD, USER)?.verificationHoldBy).toBe(MOD)
	})
})

describe('liftHoldAndVerify', () => {
	it('verifies a member who never completed a step', async () => {
		await service.handleJoin(config, USER, JOINED_AFTER)
		await service.liftHoldAndVerify(config, USER, MOD)
		expect(fake.addedRoles).toContainEqual({ guildId: GUILD, userId: USER, roleId: VERIFIED })
		expect(repo.get(GUILD, USER)?.verifiedAt).toBe(CLOCK)
	})

	it('verifies a member the bot has no record of', async () => {
		const stranger = '823456789012345678'
		await service.liftHoldAndVerify(config, stranger, MOD)
		expect(repo.get(GUILD, stranger)?.verifiedAt).toBe(CLOCK)
	})
})

describe('resetMember', () => {
	it('deletes the record and returns the member to unverified', async () => {
		await service.handleJoin(config, USER, JOINED_AFTER)
		await completeAllSteps()
		await service.resetMember(config, USER)
		expect(repo.get(GUILD, USER)).toBeNull()
		expect(fake.removedRoles).toContainEqual({ guildId: GUILD, userId: USER, roleId: VERIFIED })
	})
})
```

- [x] **Step 2: Run it to confirm it fails**

Run: `pnpm test tests/core/onboarding-service.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Write `src/core/onboarding-service.ts`**

```ts
import type { OnboardingRepository } from '../db/onboarding-repository.js'
import type { OnboardingRecord, OnboardingStep } from '../types.js'
import type { DiscordPort } from './discord-port.js'
import { evaluateGate, type GateDecision } from './gate.js'
import type { ResolvedGuildConfig } from './guild-config.js'

export type ServiceDeps = {
	readonly repo: OnboardingRepository
	readonly port: DiscordPort
	readonly now: () => string
}

export const isGrandfathered = (config: ResolvedGuildConfig, joinedAtMs: number): boolean =>
	config.grandfatherBefore !== null && joinedAtMs < Date.parse(config.grandfatherBefore)

export const createOnboardingService = (deps: ServiceDeps) => {
	const { repo, port, now } = deps

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
```

- [x] **Step 4: Run the test to confirm it passes**

Run: `pnpm test tests/core/onboarding-service.test.ts`
Expected: PASS, 18 tests.

- [x] **Step 5: Commit**

```bash
git add src/core/onboarding-service.ts tests/core/onboarding-service.test.ts
git commit -m "feat: add guild-scoped onboarding service"
```

---

### Task 4: Real DiscordPort adapter

**Files:**

- Create: `src/discord/port.ts`

**Interfaces:**

- Produces: `createDiscordPort(client): DiscordPort` — one instance for the whole process, resolving the guild per call.

- [ ] **Step 1: Write `src/discord/port.ts`**

```ts
import { DiscordAPIError, EmbedBuilder, type Client } from 'discord.js'
import type {
	AuditEntry,
	ChannelError,
	DiscordPort,
	DmContent,
	DmError,
	RoleError
} from '../core/discord-port.js'
import { err, ok, type Result } from '../types.js'

const CANNOT_SEND_TO_USER = 50007
const MISSING_PERMISSIONS = 50013
const UNKNOWN_MEMBER = 10007

const toRoleError = (error: unknown): RoleError => {
	if (error instanceof DiscordAPIError) {
		if (error.code === MISSING_PERMISSIONS) return 'missing-permission'
		if (error.code === UNKNOWN_MEMBER) return 'member-not-found'
	}
	return 'unknown'
}

export const createDiscordPort = (client: Client): DiscordPort => {
	const changeRole = async (
		guildId: string,
		userId: string,
		roleId: string,
		action: 'add' | 'remove'
	): Promise<Result<void, RoleError>> => {
		try {
			const guild = await client.guilds.fetch(guildId)
			const member = await guild.members.fetch(userId)

			if (action === 'add') await member.roles.add(roleId)
			else await member.roles.remove(roleId)

			return ok(undefined)
		} catch (error) {
			const mapped = toRoleError(error)
			console.error(
				JSON.stringify({
					level: 'error',
					event: 'role-change-failed',
					guildId,
					userId,
					roleId,
					action,
					error: mapped
				})
			)
			return err(mapped)
		}
	}

	return {
		addRole: (guildId, userId, roleId) => changeRole(guildId, userId, roleId, 'add'),
		removeRole: (guildId, userId, roleId) => changeRole(guildId, userId, roleId, 'remove'),

		sendDm: async (userId: string, content: DmContent): Promise<Result<void, DmError>> => {
			try {
				const user = await client.users.fetch(userId)
				await user.send({
					embeds: [new EmbedBuilder().setTitle(content.title).setDescription(content.body)]
				})
				return ok(undefined)
			} catch (error) {
				if (error instanceof DiscordAPIError && error.code === CANNOT_SEND_TO_USER) {
					console.info(JSON.stringify({ level: 'info', event: 'dm-closed', userId }))
					return err('dms-closed')
				}
				console.error(JSON.stringify({ level: 'error', event: 'dm-failed', userId }))
				return err('unknown')
			}
		},

		postAudit: async (
			guildId: string,
			channelId: string,
			entry: AuditEntry
		): Promise<Result<void, ChannelError>> => {
			try {
				const guild = await client.guilds.fetch(guildId)
				const channel = await guild.channels.fetch(channelId)
				if (!channel?.isTextBased()) return err('channel-not-found')

				const embed = new EmbedBuilder()
					.setTitle(entry.kind)
					.setDescription(entry.detail)
					.addFields({ name: 'Member', value: `<@${entry.userId}>`, inline: true })
					.setTimestamp()

				if (entry.actorId)
					embed.addFields({ name: 'Moderator', value: `<@${entry.actorId}>`, inline: true })

				await channel.send({ embeds: [embed] })
				return ok(undefined)
			} catch {
				console.error(JSON.stringify({ level: 'error', event: 'audit-failed', guildId, channelId }))
				return err('unknown')
			}
		}
	}
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/discord/port.ts
git commit -m "feat: add discord.js-backed DiscordPort adapter"
```

---

### Task 5: Questionnaire components

**Files:**

- Create: `src/discord/components/questionnaire.ts`
- Test: `tests/discord/questionnaire.test.ts`

**Interfaces:**

- Produces: `buildPurposeModal()`, `buildExperienceSelect()`, `buildBuiltForDiscordButtons()`, and
  `nextQuestion(answers): 'purpose' | 'experience' | 'built' | 'done'`.

- [ ] **Step 1: Write the failing test**

`nextQuestion` decides the whole resume behaviour, so it gets its own tests.

```ts
import { describe, expect, it } from 'vitest'
import { nextQuestion } from '../../src/discord/components/questionnaire.js'
import { EXPERIENCE_LEVELS, type QuestionnaireAnswers } from '../../src/types.js'

const empty: QuestionnaireAnswers = {
	guildId: 'g',
	userId: 'u',
	purpose: null,
	experienceLevel: null,
	builtForDiscord: null,
	answeredAt: null
}

describe('nextQuestion', () => {
	it('starts at purpose when nothing is answered', () => {
		expect(nextQuestion(null)).toBe('purpose')
		expect(nextQuestion(empty)).toBe('purpose')
	})

	it('moves to experience once purpose is answered', () => {
		expect(nextQuestion({ ...empty, purpose: 'learning' })).toBe('experience')
	})

	it('moves to built once experience is answered', () => {
		expect(
			nextQuestion({ ...empty, purpose: 'learning', experienceLevel: EXPERIENCE_LEVELS.NEW })
		).toBe('built')
	})

	it('reports done once all three are answered', () => {
		expect(
			nextQuestion({
				...empty,
				purpose: 'learning',
				experienceLevel: EXPERIENCE_LEVELS.NEW,
				builtForDiscord: false
			})
		).toBe('done')
	})

	it('treats a false Discord-dev answer as answered, not missing', () => {
		expect(
			nextQuestion({
				...empty,
				purpose: 'learning',
				experienceLevel: EXPERIENCE_LEVELS.NEW,
				builtForDiscord: false
			})
		).not.toBe('built')
	})
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test tests/discord/questionnaire.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/discord/components/questionnaire.ts`**

```ts
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ModalBuilder,
	StringSelectMenuBuilder,
	TextInputBuilder,
	TextInputStyle
} from 'discord.js'
import { EXPERIENCE_LEVELS, type QuestionnaireAnswers } from '../../types.js'
import { CUSTOM_IDS } from './custom-ids.js'

export const buildPurposeModal = (): ModalBuilder =>
	new ModalBuilder()
		.setCustomId(CUSTOM_IDS.purposeModal)
		.setTitle('What brings you here?')
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId(CUSTOM_IDS.purposeInput)
					.setLabel("What's your purpose here?")
					.setStyle(TextInputStyle.Paragraph)
					.setMinLength(10)
					.setMaxLength(1000)
					.setRequired(true)
			)
		)

export const buildExperienceSelect = (): ActionRowBuilder<StringSelectMenuBuilder> =>
	new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
		new StringSelectMenuBuilder()
			.setCustomId(CUSTOM_IDS.experienceSelect)
			.setPlaceholder('Pick the closest match')
			.setMinValues(1)
			.setMaxValues(1)
			.addOptions(
				{ label: 'New to everything', value: EXPERIENCE_LEVELS.NEW },
				{ label: 'I have a little bit of experience', value: EXPERIENCE_LEVELS.SOME },
				{ label: 'I write web and/or software', value: EXPERIENCE_LEVELS.WRITES },
				{ label: 'Advanced/guru status', value: EXPERIENCE_LEVELS.ADVANCED }
			)
	)

export const buildBuiltForDiscordButtons = (): ActionRowBuilder<ButtonBuilder> =>
	new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(CUSTOM_IDS.builtYes)
			.setLabel('Yes')
			.setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId(CUSTOM_IDS.builtNo)
			.setLabel('No')
			.setStyle(ButtonStyle.Secondary)
	)

export const nextQuestion = (
	answers: QuestionnaireAnswers | null
): 'purpose' | 'experience' | 'built' | 'done' => {
	if (!answers?.purpose) return 'purpose'
	if (!answers.experienceLevel) return 'experience'
	// Explicit null check: `false` is a valid answer.
	if (answers.builtForDiscord === null) return 'built'
	return 'done'
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test tests/discord/questionnaire.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/discord/components/questionnaire.ts tests/discord/questionnaire.test.ts
git commit -m "feat: add questionnaire components and resume logic"
```

---

### Task 6: `/intro` and the question prompter

**Files:**

- Create: `src/discord/commands/intro.ts`

**Interfaces:**

- Produces: `introCommand` and `promptNextQuestion(interaction, repo, guildId, userId)`.

**Critical constraint:** `showModal` must be an interaction's **first** response. `promptNextQuestion` therefore never assumes it can reply first, and callers must not reply before delegating to it when the next step could be the modal.

- [ ] **Step 1: Write `src/discord/commands/intro.ts`**

```ts
import {
	MessageFlags,
	SlashCommandBuilder,
	type ChatInputCommandInteraction,
	type MessageComponentInteraction,
	type ModalSubmitInteraction
} from 'discord.js'
import type { OnboardingRepository } from '../../db/onboarding-repository.js'
import {
	buildBuiltForDiscordButtons,
	buildExperienceSelect,
	buildPurposeModal,
	nextQuestion
} from '../components/questionnaire.js'

export const introCommand = new SlashCommandBuilder()
	.setName('intro')
	.setDescription('Start or resume the introduction questionnaire')
	.setDMPermission(false)

type PromptableInteraction =
	ChatInputCommandInteraction | MessageComponentInteraction | ModalSubmitInteraction

export const promptNextQuestion = async (
	interaction: PromptableInteraction,
	repo: OnboardingRepository,
	guildId: string,
	userId: string
): Promise<void> => {
	const step = nextQuestion(repo.getAnswers(guildId, userId))

	if (step === 'purpose') {
		// showModal must be the FIRST response to an interaction — it cannot
		// follow reply() or update(). Anything already replied to can only be
		// pointed at /intro, which arrives as a fresh interaction.
		if (!interaction.replied && !interaction.deferred && !interaction.isModalSubmit()) {
			await interaction.showModal(buildPurposeModal())
			return
		}

		await interaction.followUp({
			content: 'Run `/intro` to answer the first question.',
			flags: MessageFlags.Ephemeral
		})
		return
	}

	const payload =
		step === 'experience'
			? {
					content: "**2 of 3** — What's your level of understanding in web/software development?",
					components: [buildExperienceSelect()]
				}
			: step === 'built'
				? {
						content: '**3 of 3** — Have you ever developed anything for Discord?',
						components: [buildBuiltForDiscordButtons()]
					}
				: {
						content:
							'You have answered every question. The last step is to introduce yourself in the introductions channel.',
						components: []
					}

	if (interaction.replied || interaction.deferred)
		await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral })
	else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral })
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/discord/commands/intro.ts
git commit -m "feat: add /intro command and question prompter"
```

---

### Task 7: Event handlers

**Files:**

- Create: `src/discord/events/guild-member-add.ts`, `src/discord/events/message-create.ts`, `src/discord/events/interaction-create.ts`

**Interfaces:**

- Produces: `handleGuildMemberAdd(member, deps)`, `handleMessageCreate(message, deps)`, `handleOnboardingInteraction(interaction, deps)` where `deps` is `{ guildConfig, repo, service, now }`.
- Each resolves guild config first and returns early when the guild is disabled or unconfigured.

- [ ] **Step 1: Write a shared config resolver**

Create `src/discord/resolve-active-config.ts`:

```ts
import { resolveGuildConfig, type ResolvedGuildConfig } from '../core/guild-config.js'
import type { GuildConfigRepository } from '../db/guild-config-repository.js'
import { isOk } from '../types.js'

/** Returns config only when the guild is both enabled and fully configured. */
export const resolveActiveConfig = (
	guildConfig: GuildConfigRepository,
	guildId: string
): ResolvedGuildConfig | null => {
	const row = guildConfig.get(guildId)
	if (!row?.enabled) return null

	const resolved = resolveGuildConfig(row)
	return isOk(resolved) ? resolved.value : null
}
```

- [ ] **Step 2: Write `src/discord/events/guild-member-add.ts`**

```ts
import type { GuildMember } from 'discord.js'
import { isGrandfathered, type OnboardingService } from '../../core/onboarding-service.js'
import type { GuildConfigRepository } from '../../db/guild-config-repository.js'
import { resolveActiveConfig } from '../resolve-active-config.js'

export type MemberAddDeps = {
	readonly guildConfig: GuildConfigRepository
	readonly service: OnboardingService
}

export const handleGuildMemberAdd = async (
	member: GuildMember,
	deps: MemberAddDeps
): Promise<void> => {
	if (member.user.bot) return

	const config = resolveActiveConfig(deps.guildConfig, member.guild.id)
	if (!config) return

	const joinedAtMs = member.joinedTimestamp ?? Date.now()
	if (isGrandfathered(config, joinedAtMs)) return

	await deps.service.handleJoin(config, member.id, joinedAtMs)

	await member
		.send({
			content: `Welcome to **${member.guild.name}**. To get access: read and agree to the rules in <#${config.rulesChannelId}>, answer three quick questions, then introduce yourself in <#${config.introductionsChannelId}>.`
		})
		.catch(() => {
			console.info(
				JSON.stringify({
					level: 'info',
					event: 'join-dm-skipped',
					guildId: member.guild.id,
					userId: member.id
				})
			)
		})
}
```

- [ ] **Step 3: Write `src/discord/events/message-create.ts`**

```ts
import type { Message } from 'discord.js'
import type { OnboardingService } from '../../core/onboarding-service.js'
import type { GuildConfigRepository } from '../../db/guild-config-repository.js'
import type { OnboardingRepository } from '../../db/onboarding-repository.js'
import { resolveActiveConfig } from '../resolve-active-config.js'

export type MessageDeps = {
	readonly guildConfig: GuildConfigRepository
	readonly repo: OnboardingRepository
	readonly service: OnboardingService
}

export const handleMessageCreate = async (message: Message, deps: MessageDeps): Promise<void> => {
	if (message.author.bot || !message.guildId) return

	const config = resolveActiveConfig(deps.guildConfig, message.guildId)
	if (!config || message.channelId !== config.introductionsChannelId) return

	const existing = deps.repo.get(config.guildId, message.author.id)
	if (existing?.introPostedAt) return

	// A grandfathered member with no record posting here should not be pulled
	// into the flow; only members the bot is already tracking progress for.
	if (!existing && config.grandfatherBefore) {
		const member = await message.guild?.members.fetch(message.author.id).catch(() => null)
		const joinedAtMs = member?.joinedTimestamp ?? Date.now()
		if (joinedAtMs < Date.parse(config.grandfatherBefore)) return
	}

	await deps.service.recordStep(config, message.author.id, 'intro')
	deps.repo.setIntroMessageId(config.guildId, message.author.id, message.id)
}
```

- [ ] **Step 4: Write `src/discord/events/interaction-create.ts`**

```ts
import { MessageFlags, type Interaction } from 'discord.js'
import type { OnboardingService } from '../../core/onboarding-service.js'
import type { GuildConfigRepository } from '../../db/guild-config-repository.js'
import type { OnboardingRepository } from '../../db/onboarding-repository.js'
import type { ExperienceLevel } from '../../types.js'
import { promptNextQuestion } from '../commands/intro.js'
import { CUSTOM_IDS, parseCustomId } from '../components/custom-ids.js'
import { nextQuestion } from '../components/questionnaire.js'
import { resolveActiveConfig } from '../resolve-active-config.js'

export type OnboardingInteractionDeps = {
	readonly guildConfig: GuildConfigRepository
	readonly repo: OnboardingRepository
	readonly service: OnboardingService
	readonly now: () => string
}

const NOT_ACTIVE = 'Onboarding is not set up in this server yet.'

export const handleOnboardingInteraction = async (
	interaction: Interaction,
	deps: OnboardingInteractionDeps
): Promise<void> => {
	if (!interaction.guildId) return

	const { guildConfig, repo, service, now } = deps
	const userId = interaction.user.id

	if (interaction.isChatInputCommand() && interaction.commandName === 'intro') {
		const config = resolveActiveConfig(guildConfig, interaction.guildId)
		if (!config) {
			await interaction.reply({ content: NOT_ACTIVE, flags: MessageFlags.Ephemeral })
			return
		}
		await promptNextQuestion(interaction, repo, config.guildId, userId)
		return
	}

	if (interaction.isModalSubmit() && interaction.customId === CUSTOM_IDS.purposeModal) {
		const config = resolveActiveConfig(guildConfig, interaction.guildId)
		if (!config) return

		repo.saveAnswer(
			config.guildId,
			userId,
			{ purpose: interaction.fields.getTextInputValue(CUSTOM_IDS.purposeInput) },
			now()
		)
		await interaction.reply({ content: '**1 of 3** answered.', flags: MessageFlags.Ephemeral })
		await promptNextQuestion(interaction, repo, config.guildId, userId)
		return
	}

	if (interaction.isStringSelectMenu() && interaction.customId === CUSTOM_IDS.experienceSelect) {
		const config = resolveActiveConfig(guildConfig, interaction.guildId)
		if (!config) return

		const value = interaction.values[0]
		if (!value) return

		repo.saveAnswer(config.guildId, userId, { experienceLevel: value as ExperienceLevel }, now())
		await interaction.update({ content: '**2 of 3** answered.', components: [] })
		await promptNextQuestion(interaction, repo, config.guildId, userId)
		return
	}

	if (!interaction.isButton()) return

	const parsed = parseCustomId(interaction.customId)
	if (!parsed) return

	const config = resolveActiveConfig(guildConfig, interaction.guildId)
	if (!config) {
		await interaction.reply({ content: NOT_ACTIVE, flags: MessageFlags.Ephemeral })
		return
	}

	if (parsed.action === 'rules-agree') {
		await service.recordStep(config, userId, 'rules')
		// No reply() here on purpose. The next question is a modal, and showModal
		// must be the first response to this interaction.
		await promptNextQuestion(interaction, repo, config.guildId, userId)
		return
	}

	if (parsed.action === 'q3') {
		repo.saveAnswer(config.guildId, userId, { builtForDiscord: parsed.value === 'yes' }, now())

		// Completion is derived from the stored answers, never asserted by this
		// handler — a stale button must not mark an unfinished questionnaire done.
		const complete = nextQuestion(repo.getAnswers(config.guildId, userId)) === 'done'

		if (complete) {
			await service.recordStep(config, userId, 'questionnaire')
			await interaction.update({
				content: `**3 of 3** answered. Last step: introduce yourself in <#${config.introductionsChannelId}>.`,
				components: []
			})
			return
		}

		await interaction.update({ content: 'Answer saved.', components: [] })
		await promptNextQuestion(interaction, repo, config.guildId, userId)
	}
}
```

- [ ] **Step 5: Wire into `src/index.ts`**

Inside `ClientReady`, after command registration:

```ts
const port = createDiscordPort(ready)
const service = createOnboardingService({
	repo: onboarding,
	port,
	now: () => new Date().toISOString()
})

for (const config of guildConfig.listEnabled()) {
	const guild = await ready.guilds.fetch(config.guildId).catch(() => null)
	if (guild) await reconcile({ guild, guildConfig, repo: onboarding, service, port })
}
```

Add the listeners, all through `safeHandler`:

```ts
const onboardingDeps = {
	guildConfig,
	repo: onboarding,
	service,
	now: () => new Date().toISOString()
}

client.on(
	Events.GuildMemberAdd,
	safeHandler('guildMemberAdd', (member) => handleGuildMemberAdd(member, onboardingDeps))
)

client.on(
	Events.MessageCreate,
	safeHandler('messageCreate', (message) => handleMessageCreate(message, onboardingDeps))
)
```

Extend the existing `InteractionCreate` listener to delegate to `handleOnboardingInteraction` after the `/config` branches. Add `introCommand.toJSON()` to the array in `register-commands.ts`.

- [ ] **Step 6: Walk the whole flow by hand**

On a throwaway guild with onboarding enabled, using a second account:

1. Join → `unverified` applied, welcome DM arrives
2. Click **I agree** → the purpose modal opens immediately (this is the case that was broken before the review — no reply precedes it)
3. Submit the modal → question 2 select menu appears
4. Pick a level → question 3 buttons appear
5. Answer → prompted to post in introductions
6. Post any message → `verified` appears, `unverified` disappears, audit embed lands in the mod log

Then confirm the negative cases: an account that was already in the guild before `/config enable` is untouched throughout, and `/intro` in a disabled guild replies that onboarding is not set up.

- [ ] **Step 7: Commit**

```bash
git add src/discord src/index.ts
git commit -m "feat: wire up the verification gate flow"
```

---

### Task 8: Startup reconciliation

**Files:**

- Create: `src/tasks/reconcile.ts`
- Test: `tests/tasks/reconcile.test.ts`

**Interfaces:**

- Produces: `reconcileMembers(deps, config, members): Promise<ReconcileSummary>` taking a plain array of `{ userId, isBot, joinedAtMs, roleIds }`, plus the discord.js wrapper `reconcile({ guild, guildConfig, repo, service, port })`.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { ResolvedGuildConfig } from '../../src/core/guild-config.js'
import { createOnboardingService } from '../../src/core/onboarding-service.js'
import { createOnboardingRepository } from '../../src/db/onboarding-repository.js'
import { reconcileMembers } from '../../src/tasks/reconcile.js'
import { createFakeDiscordPort } from '../helpers/fake-discord-port.js'
import { createTestDb } from '../helpers/test-db.js'

const GUILD = '123456789012345678'
const VERIFIED = '423456789012345678'
const UNVERIFIED = '523456789012345678'
const AT = '2026-08-10T12:00:00.000Z'
const ENABLED_AT = '2026-08-10T00:00:00.000Z'
const JOINED_AFTER = Date.parse('2026-08-10T06:00:00.000Z')
const JOINED_BEFORE = Date.parse('2026-08-01T00:00:00.000Z')

const config: ResolvedGuildConfig = {
	guildId: GUILD,
	rulesChannelId: '1',
	introductionsChannelId: '2',
	modLogChannelId: '3',
	verifiedRoleId: VERIFIED,
	unverifiedRoleId: UNVERIFIED,
	rulesText: 'rules',
	rulesMessageId: null,
	grandfatherBefore: ENABLED_AT
}

let repo: ReturnType<typeof createOnboardingRepository>
let fake: ReturnType<typeof createFakeDiscordPort>
let deps: Parameters<typeof reconcileMembers>[0]

const member = (userId: string, roleIds: string[] = [], joinedAtMs = JOINED_AFTER) => ({
	userId,
	isBot: false,
	joinedAtMs,
	roleIds
})

beforeEach(() => {
	repo = createOnboardingRepository(createTestDb())
	fake = createFakeDiscordPort()
	deps = {
		repo,
		service: createOnboardingService({ repo, port: fake.port, now: () => AT }),
		port: fake.port
	}
})

describe('reconcileMembers', () => {
	it('creates a record and applies unverified for someone who joined during downtime', async () => {
		await reconcileMembers(deps, config, [member('u1')])
		expect(repo.get(GUILD, 'u1')).not.toBeNull()
		expect(fake.addedRoles).toContainEqual({ guildId: GUILD, userId: 'u1', roleId: UNVERIFIED })
	})

	it('never touches a member who joined before the guild was enabled', async () => {
		await reconcileMembers(deps, config, [member('u2', [], JOINED_BEFORE)])
		expect(repo.get(GUILD, 'u2')).toBeNull()
		expect(fake.addedRoles).toHaveLength(0)
	})

	it('skips bots entirely', async () => {
		await reconcileMembers(deps, config, [{ ...member('bot'), isBot: true }])
		expect(fake.addedRoles).toHaveLength(0)
	})

	it('re-applies a missing verified role', async () => {
		repo.upsertOnJoin(GUILD, 'u3', AT)
		repo.markVerified(GUILD, 'u3', AT)
		await reconcileMembers(deps, config, [member('u3')])
		expect(fake.addedRoles).toContainEqual({ guildId: GUILD, userId: 'u3', roleId: VERIFIED })
	})

	it('strips the verified role from a held member', async () => {
		repo.upsertOnJoin(GUILD, 'u4', AT)
		repo.setHold(GUILD, 'u4', AT, 'mod')
		await reconcileMembers(deps, config, [member('u4', [VERIFIED])])
		expect(fake.removedRoles).toContainEqual({ guildId: GUILD, userId: 'u4', roleId: VERIFIED })
	})

	it('grants verified to someone who finished every step while the bot was offline', async () => {
		repo.upsertOnJoin(GUILD, 'u5', AT)
		for (const step of ['rules', 'questionnaire', 'intro'] as const)
			repo.stampStep(GUILD, 'u5', step, AT)

		await reconcileMembers(deps, config, [member('u5', [UNVERIFIED])])
		expect(fake.addedRoles).toContainEqual({ guildId: GUILD, userId: 'u5', roleId: VERIFIED })
	})

	it('reports an anomaly for someone holding verified with no record', async () => {
		await reconcileMembers(deps, config, [member('u6', [VERIFIED])])
		expect(fake.audits.some((entry) => entry.kind === 'reconcile-anomaly')).toBe(true)
	})

	it('summarises what it did', async () => {
		const summary = await reconcileMembers(deps, config, [
			member('a'),
			member('b'),
			member('c', [], JOINED_BEFORE)
		])
		expect(summary.created).toBe(2)
		expect(summary.grandfathered).toBe(1)
	})
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test tests/tasks/reconcile.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/tasks/reconcile.ts`**

```ts
import type { Guild } from 'discord.js'
import type { DiscordPort } from '../core/discord-port.js'
import type { ResolvedGuildConfig } from '../core/guild-config.js'
import { isGrandfathered, type OnboardingService } from '../core/onboarding-service.js'
import type { GuildConfigRepository } from '../db/guild-config-repository.js'
import type { OnboardingRepository } from '../db/onboarding-repository.js'
import { resolveActiveConfig } from '../discord/resolve-active-config.js'

export type ReconcileMember = {
	readonly userId: string
	readonly isBot: boolean
	readonly joinedAtMs: number
	readonly roleIds: readonly string[]
}

export type ReconcileDeps = {
	readonly repo: OnboardingRepository
	readonly service: OnboardingService
	readonly port: DiscordPort
}

export type ReconcileSummary = {
	created: number
	grandfathered: number
	rolesRestored: number
	holdsEnforced: number
	granted: number
	anomalies: number
}

export const reconcileMembers = async (
	deps: ReconcileDeps,
	config: ResolvedGuildConfig,
	members: readonly ReconcileMember[]
): Promise<ReconcileSummary> => {
	const summary: ReconcileSummary = {
		created: 0,
		grandfathered: 0,
		rolesRestored: 0,
		holdsEnforced: 0,
		granted: 0,
		anomalies: 0
	}

	for (const member of members) {
		if (member.isBot) continue

		// Checked before anything else: an existing member from before the guild
		// was enabled must never be restricted by a bot restart.
		if (isGrandfathered(config, member.joinedAtMs)) {
			summary.grandfathered += 1
			continue
		}

		const record = deps.repo.get(config.guildId, member.userId)
		const hasVerifiedRole = member.roleIds.includes(config.verifiedRoleId)

		if (!record) {
			if (hasVerifiedRole) {
				summary.anomalies += 1
				await deps.port.postAudit(config.guildId, config.modLogChannelId, {
					kind: 'reconcile-anomaly',
					userId: member.userId,
					detail: 'Holds the verified role but has no onboarding record. Left unchanged for review.'
				})
				continue
			}
			await deps.service.handleJoin(config, member.userId, member.joinedAtMs)
			summary.created += 1
			continue
		}

		if (record.verificationHoldAt) {
			if (hasVerifiedRole) {
				await deps.port.removeRole(config.guildId, member.userId, config.verifiedRoleId)
				await deps.port.addRole(config.guildId, member.userId, config.unverifiedRoleId)
				summary.holdsEnforced += 1
			}
			continue
		}

		if (record.verifiedAt) {
			if (!hasVerifiedRole) {
				await deps.port.addRole(config.guildId, member.userId, config.verifiedRoleId)
				await deps.port.removeRole(config.guildId, member.userId, config.unverifiedRoleId)
				summary.rolesRestored += 1
			}
			continue
		}

		if (record.rulesAcceptedAt && record.questionnaireCompletedAt && record.introPostedAt) {
			await deps.service.grantVerified(config, record)
			summary.granted += 1
			continue
		}

		if (hasVerifiedRole) {
			summary.anomalies += 1
			await deps.port.postAudit(config.guildId, config.modLogChannelId, {
				kind: 'reconcile-anomaly',
				userId: member.userId,
				detail: 'Holds the verified role without completing onboarding. Left unchanged for review.'
			})
		}
	}

	return summary
}

export const reconcile = async (deps: {
	guild: Guild
	guildConfig: GuildConfigRepository
	repo: OnboardingRepository
	service: OnboardingService
	port: DiscordPort
}): Promise<ReconcileSummary | null> => {
	const config = resolveActiveConfig(deps.guildConfig, deps.guild.id)
	if (!config) return null

	const members = await deps.guild.members.fetch()

	const summary = await reconcileMembers(
		{ repo: deps.repo, service: deps.service, port: deps.port },
		config,
		members.map((member) => ({
			userId: member.id,
			isBot: member.user.bot,
			joinedAtMs: member.joinedTimestamp ?? Date.now(),
			roleIds: [...member.roles.cache.keys()]
		}))
	)

	console.info(
		JSON.stringify({
			level: 'info',
			event: 'reconcile-complete',
			guildId: deps.guild.id,
			...summary
		})
	)

	return summary
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test tests/tasks/reconcile.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Verify against the test guild**

Stop the bot, join with a second account, restart.
Expected: a `reconcile-complete` line with `created: 1` and a `grandfathered` count matching the members who were present before enabling. Those grandfathered accounts must still hold no onboarding role.

- [ ] **Step 6: Commit**

```bash
git add src/tasks/reconcile.ts tests/tasks/reconcile.test.ts
git commit -m "feat: add guild-scoped startup reconciliation"
```

## Acceptance Criteria

- In an enabled guild, a new member receives `unverified` within seconds of joining
- **A member who joined before `/config enable` is never given `unverified`** — not on join, not on reconcile, not by posting in the introductions channel
- Clicking **I agree** opens the purpose modal directly, with no intermediate reply
- The questionnaire can be abandoned and resumed with `/intro` at the correct question
- Answering question 3 out of order does not mark the questionnaire complete
- Posting any message in the introductions channel completes the final step
- Completing steps in a non-standard order still verifies correctly
- A held member never receives `verified`, whatever completes afterwards
- A failed role assignment leaves `verified_at` null so the next event retries
- Nothing at all happens in a guild that is unconfigured or disabled
- `src/core/` contains no `discord.js` import
- `pnpm test` and `pnpm typecheck` pass

## UI/UX Pattern

_N/A — no web UI surface. Member interaction uses native Discord modals, select menus, and buttons._

## Open Questions

- [ ] None.

## Dependencies

- Requires: [[02-guild-configuration]]
- Blocks: [[04-reminders-and-mod-tooling]]

## Decisions

- 2026-08-10 — The rules `I agree` handler does **not** reply before delegating to the prompter. `showModal` must be an interaction's first response, so replying first would break the primary path on every single new member.
- 2026-08-10 — `grantVerified` applies the role **before** stamping `verified_at`. If Discord rejects the change the record stays unverified and the next event retries, rather than the database claiming a success the server never saw.
- 2026-08-10 — Questionnaire completion is derived from the stored answers via `nextQuestion`, never asserted by the button handler, so a stale component cannot mark an unfinished questionnaire done.
- 2026-08-10 — Service methods take `ResolvedGuildConfig` rather than loose ids, making a half-configured guild unrepresentable below the adapter layer.
- 2026-08-10 — `recordStep`, `applyHold` and `liftHoldAndVerify` upsert the record first, so acting on a member the bot has never seen works instead of silently updating zero rows.
- 2026-08-10 — `reconcileMembers` takes a plain array so the drift logic is testable without a gateway; `reconcile` is the thin mapping wrapper.
