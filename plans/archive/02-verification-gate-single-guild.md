---
plan: verification-gate
project: discord-developer
updated: 2026-08-08
status: 🔵 Planning
tags: [plan]
---

# 02 — Verification gate flow

> ⚠️ **SUPERSEDED — archived 2026-08-10.** This is the single-guild draft, replaced by the
> multi-guild rework. Do not implement from this file. The current plans are
> [[01-bot-foundation]], [[02-guild-configuration]], [[03-verification-gate]] and
> [[04-reminders-and-mod-tooling]]. Kept only for history.

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md`](../docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md)

## Status

🔵 Planning

## Goal

> A member can join the guild and reach `verified` entirely through Discord UI: they receive `unverified` on join, accept the rules from a persistent message in `#rules`, answer three questions, post in `#introductions`, and the role flips automatically. Drift accumulated while the bot was offline is repaired on the next boot.

## Global Constraints

Inherits every constraint from [[01-bot-foundation]]. Additionally:

- `src/core/` must never import `discord.js`. The dependency direction is `discord/ → core/ → db/`.
- Every path that could complete onboarding calls `evaluateGate` — no handler decides on its own whether to grant a role.
- All timestamps come from an injected `now()` so tests never depend on wall-clock time.

## File Structure

| File                                       | Responsibility                                |
| ------------------------------------------ | --------------------------------------------- |
| `src/core/gate.ts`                         | `evaluateGate` — the single decision function |
| `src/core/discord-port.ts`                 | `DiscordPort` interface and its error types   |
| `src/core/onboarding-service.ts`           | Record a step, evaluate, emit effects         |
| `src/discord/port.ts`                      | Real `DiscordPort` backed by discord.js       |
| `src/discord/components/custom-ids.ts`     | Build and parse component ids                 |
| `src/discord/components/rules-message.ts`  | Persistent rules embed + agree button         |
| `src/discord/components/questionnaire.ts`  | Modal, select menu, yes/no buttons            |
| `src/discord/events/guild-member-add.ts`   | Join handling and rejoin restore              |
| `src/discord/events/message-create.ts`     | `#introductions` watcher                      |
| `src/discord/events/interaction-create.ts` | Routes buttons, selects, modals, commands     |
| `src/discord/commands/intro.ts`            | `/intro` re-entry point                       |
| `src/tasks/reconcile.ts`                   | Startup drift repair                          |

---

### Task 1: The gate

**Files:**

- Create: `src/core/gate.ts`
- Test: `tests/core/gate.test.ts`

**Interfaces:**

- Consumes: `OnboardingRecord` from `src/types.ts`.
- Produces: `evaluateGate(record: OnboardingRecord): GateDecision` where
  `GateDecision = 'grant' | 'already-verified' | 'held' | 'incomplete'`. Every later task calls this.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { evaluateGate } from '../../src/core/gate.js'
import type { OnboardingRecord } from '../../src/types.js'

const baseRecord: OnboardingRecord = {
	userId: '1',
	guildId: '2',
	firstJoinedAt: '2026-08-08T10:00:00.000Z',
	lastJoinedAt: '2026-08-08T10:00:00.000Z',
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

const AT = '2026-08-08T11:00:00.000Z'
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

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test tests/core/gate.test.ts`
Expected: FAIL — cannot resolve `../../src/core/gate.js`.

- [ ] **Step 3: Write `src/core/gate.ts`**

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

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test tests/core/gate.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/gate.ts tests/core/gate.test.ts
git commit -m "feat: add verification gate decision function"
```

---

### Task 2: DiscordPort interface and test fake

**Files:**

- Create: `src/core/discord-port.ts`
- Create: `tests/helpers/fake-discord-port.ts`

**Interfaces:**

- Produces: `DiscordPort`, `RoleError`, `DmError`, `ChannelError`, `AuditEntry`, `DmContent`, and `createFakeDiscordPort()` exposing `{ port, addedRoles, removedRoles, dms, audits, failDmFor }`. Tasks 3, 9 and all of plan 03 use these exact names.

- [ ] **Step 1: Write `src/core/discord-port.ts`**

```ts
import type { Result } from '../types.js'

export type RoleError = 'member-not-found' | 'role-not-found' | 'missing-permission' | 'unknown'
export type DmError = 'dms-closed' | 'member-not-found' | 'unknown'
export type ChannelError = 'channel-not-found' | 'missing-permission' | 'unknown'

export type DmContent = { readonly title: string; readonly body: string }

export type AuditEntry = {
	readonly kind: 'rules-accepted' | 'verified' | 'mod-action' | 'reconcile-anomaly'
	readonly userId: string
	readonly detail: string
	readonly actorId?: string
}

export type DiscordPort = {
	addRole: (userId: string, roleId: string) => Promise<Result<void, RoleError>>
	removeRole: (userId: string, roleId: string) => Promise<Result<void, RoleError>>
	sendDm: (userId: string, content: DmContent) => Promise<Result<void, DmError>>
	postAudit: (entry: AuditEntry) => Promise<Result<void, ChannelError>>
}
```

- [ ] **Step 2: Write `tests/helpers/fake-discord-port.ts`**

```ts
import type { AuditEntry, DiscordPort, DmContent } from '../../src/core/discord-port.js'
import { err, ok } from '../../src/types.js'

export const createFakeDiscordPort = () => {
	const addedRoles: { userId: string; roleId: string }[] = []
	const removedRoles: { userId: string; roleId: string }[] = []
	const dms: { userId: string; content: DmContent }[] = []
	const audits: AuditEntry[] = []
	const dmFailures = new Set<string>()

	const port: DiscordPort = {
		addRole: async (userId, roleId) => {
			addedRoles.push({ userId, roleId })
			return ok(undefined)
		},
		removeRole: async (userId, roleId) => {
			removedRoles.push({ userId, roleId })
			return ok(undefined)
		},
		sendDm: async (userId, content) => {
			if (dmFailures.has(userId)) return err('dms-closed')
			dms.push({ userId, content })
			return ok(undefined)
		},
		postAudit: async (entry) => {
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
		failDmFor: (userId: string) => dmFailures.add(userId)
	}
}
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/core/discord-port.ts tests/helpers/fake-discord-port.ts
git commit -m "feat: add DiscordPort interface and test fake"
```

---

### Task 3: Onboarding service

**Files:**

- Create: `src/core/onboarding-service.ts`
- Test: `tests/core/onboarding-service.test.ts`

**Interfaces:**

- Consumes: `OnboardingRepository` (plan 01 task 5), `DiscordPort`, `evaluateGate`.
- Produces: `createOnboardingService(deps): OnboardingService` with
  `recordStep(userId, step)`, `handleJoin(userId, guildId)`, `grantVerified(record)`,
  `applyHold(userId, actorId)`, `liftHoldAndVerify(userId, actorId)`, `resetMember(userId)`.
  Plan 03's mod commands call the last three.
- `deps` is `{ repo, port, verifiedRoleId, unverifiedRoleId, now }` where `now: () => string`.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createOnboardingRepository } from '../../src/db/onboarding-repository.js'
import { createOnboardingService } from '../../src/core/onboarding-service.js'
import { EXPERIENCE_LEVELS } from '../../src/types.js'
import { createFakeDiscordPort } from '../helpers/fake-discord-port.js'
import { createTestDb } from '../helpers/test-db.js'

const GUILD = '123456789012345678'
const USER = '223456789012345678'
const MOD = '323456789012345678'
const VERIFIED = '423456789012345678'
const UNVERIFIED = '523456789012345678'

let repo: ReturnType<typeof createOnboardingRepository>
let fake: ReturnType<typeof createFakeDiscordPort>
let service: ReturnType<typeof createOnboardingService>
let clock: string

beforeEach(() => {
	repo = createOnboardingRepository(createTestDb())
	fake = createFakeDiscordPort()
	clock = '2026-08-08T10:00:00.000Z'
	service = createOnboardingService({
		repo,
		port: fake.port,
		verifiedRoleId: VERIFIED,
		unverifiedRoleId: UNVERIFIED,
		now: () => clock
	})
})

const completeAllSteps = async () => {
	await service.recordStep(USER, 'rules')
	repo.saveAnswer(USER, { purpose: 'learning' }, clock)
	repo.saveAnswer(USER, { experienceLevel: EXPERIENCE_LEVELS.SOME }, clock)
	repo.saveAnswer(USER, { builtForDiscord: false }, clock)
	await service.recordStep(USER, 'questionnaire')
	return service.recordStep(USER, 'intro')
}

describe('handleJoin', () => {
	it('applies the unverified role to a brand new member', async () => {
		await service.handleJoin(USER, GUILD)
		expect(fake.addedRoles).toContainEqual({ userId: USER, roleId: UNVERIFIED })
	})

	it('restores verified without re-running the flow for a returning verified member', async () => {
		await service.handleJoin(USER, GUILD)
		await completeAllSteps()
		fake.addedRoles.length = 0

		await service.handleJoin(USER, GUILD)

		expect(fake.addedRoles).toContainEqual({ userId: USER, roleId: VERIFIED })
		expect(fake.addedRoles).not.toContainEqual({ userId: USER, roleId: UNVERIFIED })
	})

	it('does not restore verified for a returning member under a hold', async () => {
		await service.handleJoin(USER, GUILD)
		await completeAllSteps()
		await service.applyHold(USER, MOD)
		fake.addedRoles.length = 0

		await service.handleJoin(USER, GUILD)

		expect(fake.addedRoles).toContainEqual({ userId: USER, roleId: UNVERIFIED })
		expect(fake.addedRoles).not.toContainEqual({ userId: USER, roleId: VERIFIED })
	})
})

describe('recordStep', () => {
	beforeEach(() => service.handleJoin(USER, GUILD))

	it('reports incomplete until all three steps are done', async () => {
		expect(await service.recordStep(USER, 'rules')).toBe('incomplete')
		expect(await service.recordStep(USER, 'intro')).toBe('incomplete')
	})

	it('grants verified and removes unverified once every step is done', async () => {
		expect(await completeAllSteps()).toBe('grant')
		expect(fake.addedRoles).toContainEqual({ userId: USER, roleId: VERIFIED })
		expect(fake.removedRoles).toContainEqual({ userId: USER, roleId: UNVERIFIED })
		expect(repo.get(USER)?.verifiedAt).toBe(clock)
	})

	it('accepts steps in any order', async () => {
		await service.recordStep(USER, 'intro')
		repo.saveAnswer(USER, { purpose: 'p' }, clock)
		repo.saveAnswer(USER, { experienceLevel: EXPERIENCE_LEVELS.NEW }, clock)
		repo.saveAnswer(USER, { builtForDiscord: true }, clock)
		await service.recordStep(USER, 'questionnaire')
		expect(await service.recordStep(USER, 'rules')).toBe('grant')
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
		expect(fake.addedRoles).toContainEqual({ userId: USER, roleId: VERIFIED })
	})

	it('does not re-grant for an already verified member', async () => {
		await completeAllSteps()
		fake.addedRoles.length = 0
		expect(await service.recordStep(USER, 'rules')).toBe('already-verified')
		expect(fake.addedRoles).toHaveLength(0)
	})
})

describe('applyHold', () => {
	beforeEach(async () => {
		await service.handleJoin(USER, GUILD)
		await completeAllSteps()
	})

	it('removes the verified role and re-applies unverified', async () => {
		await service.applyHold(USER, MOD)
		expect(fake.removedRoles).toContainEqual({ userId: USER, roleId: VERIFIED })
		expect(fake.addedRoles).toContainEqual({ userId: USER, roleId: UNVERIFIED })
	})

	it('keeps the member unverified even when a further step fires', async () => {
		await service.applyHold(USER, MOD)
		fake.addedRoles.length = 0
		expect(await service.recordStep(USER, 'rules')).toBe('held')
		expect(fake.addedRoles).not.toContainEqual({ userId: USER, roleId: VERIFIED })
	})

	it('records the acting moderator', async () => {
		await service.applyHold(USER, MOD)
		expect(repo.get(USER)?.verificationHoldBy).toBe(MOD)
	})
})

describe('liftHoldAndVerify', () => {
	it('verifies a member who never completed any step', async () => {
		await service.handleJoin(USER, GUILD)
		await service.liftHoldAndVerify(USER, MOD)
		expect(fake.addedRoles).toContainEqual({ userId: USER, roleId: VERIFIED })
		expect(repo.get(USER)?.verifiedAt).toBe(clock)
	})
})

describe('resetMember', () => {
	it('deletes the record and puts the member back to unverified', async () => {
		await service.handleJoin(USER, GUILD)
		await completeAllSteps()
		await service.resetMember(USER)
		expect(repo.get(USER)).toBeNull()
		expect(fake.removedRoles).toContainEqual({ userId: USER, roleId: VERIFIED })
	})
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test tests/core/onboarding-service.test.ts`
Expected: FAIL — cannot resolve `onboarding-service.js`.

- [ ] **Step 3: Write `src/core/onboarding-service.ts`**

```ts
import type { OnboardingRepository } from '../db/onboarding-repository.js'
import type { OnboardingRecord, OnboardingStep } from '../types.js'
import type { DiscordPort } from './discord-port.js'
import { evaluateGate, type GateDecision } from './gate.js'

export type ServiceDeps = {
	readonly repo: OnboardingRepository
	readonly port: DiscordPort
	readonly verifiedRoleId: string
	readonly unverifiedRoleId: string
	readonly now: () => string
}

export const createOnboardingService = (deps: ServiceDeps) => {
	const { repo, port, verifiedRoleId, unverifiedRoleId, now } = deps

	const grantVerified = async (record: OnboardingRecord): Promise<void> => {
		const at = now()
		repo.markVerified(record.userId, at)

		const added = await port.addRole(record.userId, verifiedRoleId)
		if (!added.ok) {
			await port.postAudit({
				kind: 'verified',
				userId: record.userId,
				detail: `Failed to add verified role: ${added.error}`
			})
			return
		}

		await port.removeRole(record.userId, unverifiedRoleId)

		const answers = repo.getAnswers(record.userId)
		await port.postAudit({
			kind: 'verified',
			userId: record.userId,
			detail: answers
				? `purpose="${answers.purpose ?? ''}" experience=${answers.experienceLevel ?? 'unknown'} builtForDiscord=${String(answers.builtForDiscord)}`
				: 'verified with no stored answers'
		})

		await port.sendDm(record.userId, {
			title: 'You are verified',
			body: 'Thanks for completing onboarding — the rest of the server is now open to you.'
		})
	}

	const applyUnverified = async (userId: string): Promise<void> => {
		await port.addRole(userId, unverifiedRoleId)
		await port.removeRole(userId, verifiedRoleId)
	}

	const recordStep = async (userId: string, step: OnboardingStep): Promise<GateDecision> => {
		repo.stampStep(userId, step, now())
		const record = repo.get(userId)
		if (!record) return 'incomplete'

		const decision = evaluateGate(record)
		if (decision === 'grant') await grantVerified(record)
		return decision
	}

	return {
		recordStep,
		grantVerified,

		handleJoin: async (userId: string, guildId: string): Promise<void> => {
			repo.upsertOnJoin(userId, guildId, now())
			const record = repo.get(userId)
			if (!record) return

			if (record.verifiedAt && !record.verificationHoldAt) {
				await port.addRole(userId, verifiedRoleId)
				return
			}

			await applyUnverified(userId)
		},

		applyHold: async (userId: string, actorId: string): Promise<void> => {
			repo.setHold(userId, now(), actorId)
			await applyUnverified(userId)
			await port.postAudit({
				kind: 'mod-action',
				userId,
				actorId,
				detail: 'verification hold applied'
			})
		},

		liftHoldAndVerify: async (userId: string, actorId: string): Promise<void> => {
			repo.clearHold(userId)
			for (const step of ['rules', 'questionnaire', 'intro'] as const)
				repo.stampStep(userId, step, now())

			const record = repo.get(userId)
			if (!record) return

			await grantVerified(record)
			await port.postAudit({
				kind: 'mod-action',
				userId,
				actorId,
				detail: 'manually verified'
			})
		},

		resetMember: async (userId: string): Promise<void> => {
			repo.remove(userId)
			await applyUnverified(userId)
		}
	}
}

export type OnboardingService = ReturnType<typeof createOnboardingService>
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test tests/core/onboarding-service.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/onboarding-service.ts tests/core/onboarding-service.test.ts
git commit -m "feat: add onboarding service orchestrating steps and role grants"
```

---

### Task 4: Real DiscordPort adapter

**Files:**

- Create: `src/discord/port.ts`

**Interfaces:**

- Consumes: `DiscordPort` from `src/core/discord-port.ts`, `Config`.
- Produces: `createDiscordPort(guild: Guild, modLogChannelId: string): DiscordPort`.

- [ ] **Step 1: Write `src/discord/port.ts`**

```ts
import { DiscordAPIError, EmbedBuilder, type Guild } from 'discord.js'
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

export const createDiscordPort = (guild: Guild, modLogChannelId: string): DiscordPort => {
	const changeRole = async (
		userId: string,
		roleId: string,
		action: 'add' | 'remove'
	): Promise<Result<void, RoleError>> => {
		try {
			const member = await guild.members.fetch(userId)
			if (action === 'add') await member.roles.add(roleId)
			else await member.roles.remove(roleId)
			return ok(undefined)
		} catch (error) {
			const mapped = toRoleError(error)
			console.error(
				JSON.stringify({
					level: 'error',
					event: 'role-change',
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
		addRole: (userId, roleId) => changeRole(userId, roleId, 'add'),
		removeRole: (userId, roleId) => changeRole(userId, roleId, 'remove'),

		sendDm: async (userId: string, content: DmContent): Promise<Result<void, DmError>> => {
			try {
				const member = await guild.members.fetch(userId)
				await member.send({
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

		postAudit: async (entry: AuditEntry): Promise<Result<void, ChannelError>> => {
			try {
				const channel = await guild.channels.fetch(modLogChannelId)
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
				console.error(JSON.stringify({ level: 'error', event: 'audit-failed', entry }))
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

### Task 5: Custom component ids

**Files:**

- Create: `src/discord/components/custom-ids.ts`
- Test: `tests/discord/custom-ids.test.ts`

**Interfaces:**

- Produces: `CUSTOM_IDS` (the literal id constants) and `parseCustomId(raw): ParsedCustomId | null`.
  Task 6, 7 and the interaction router consume these instead of string literals.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { CUSTOM_IDS, parseCustomId } from '../../src/discord/components/custom-ids.js'

describe('parseCustomId', () => {
	it('parses the rules agree button', () => {
		expect(parseCustomId(CUSTOM_IDS.rulesAgree)).toEqual({
			namespace: 'onboarding',
			action: 'rules-agree'
		})
	})

	it('parses the questionnaire yes/no answer with its value', () => {
		expect(parseCustomId('onboarding:q3:yes')).toEqual({
			namespace: 'onboarding',
			action: 'q3',
			value: 'yes'
		})
	})

	it('returns null for an id belonging to another feature', () => {
		expect(parseCustomId('some-other-bot:thing')).toBeNull()
	})
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test tests/discord/custom-ids.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/discord/components/custom-ids.ts`**

```ts
const NAMESPACE = 'onboarding'

export const CUSTOM_IDS = {
	rulesAgree: `${NAMESPACE}:rules-agree`,
	startQuestionnaire: `${NAMESPACE}:start-questionnaire`,
	purposeModal: `${NAMESPACE}:q1-modal`,
	purposeInput: `${NAMESPACE}:q1-input`,
	experienceSelect: `${NAMESPACE}:q2`,
	builtYes: `${NAMESPACE}:q3:yes`,
	builtNo: `${NAMESPACE}:q3:no`
} as const

export type ParsedCustomId = {
	readonly namespace: string
	readonly action: string
	readonly value?: string
}

export const parseCustomId = (raw: string): ParsedCustomId | null => {
	const [namespace, action, value] = raw.split(':')
	if (namespace !== NAMESPACE || !action) return null
	return value === undefined ? { namespace, action } : { namespace, action, value }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test tests/discord/custom-ids.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/discord/components/custom-ids.ts tests/discord/custom-ids.test.ts
git commit -m "feat: add namespaced component id helpers"
```

---

### Task 6: Persistent rules message

**Files:**

- Create: `src/discord/components/rules-message.ts`

**Interfaces:**

- Consumes: `CUSTOM_IDS`.
- Produces: `buildRulesMessage(): { embeds, components }` and
  `ensureRulesMessage(guild, rulesChannelId): Promise<void>` — idempotent, called once after preflight.

- [ ] **Step 1: Write `src/discord/components/rules-message.ts`**

```ts
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	type Guild,
	type MessageCreateOptions
} from 'discord.js'
import { CUSTOM_IDS } from './custom-ids.js'

export const RULES = [
	'Be respectful. No harassment, hate speech, or personal attacks.',
	'No spam, unsolicited advertising, or mass DMs.',
	'Keep discussion in the channel it belongs in.',
	'No piracy, malware, or requests for either.',
	'Moderator decisions are final — raise disputes in a ticket, not in public.'
] as const

export const buildRulesMessage = (): MessageCreateOptions => {
	const embed = new EmbedBuilder()
		.setTitle('Server rules')
		.setDescription(RULES.map((rule, index) => `**${index + 1}.** ${rule}`).join('\n\n'))
		.setFooter({ text: 'Agreeing is the first of three steps to get verified.' })

	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(CUSTOM_IDS.rulesAgree)
			.setLabel('I agree')
			.setStyle(ButtonStyle.Success)
	)

	return { embeds: [embed], components: [row] }
}

export const ensureRulesMessage = async (guild: Guild, rulesChannelId: string): Promise<void> => {
	const channel = await guild.channels.fetch(rulesChannelId)
	if (!channel?.isTextBased()) throw new Error(`Rules channel ${rulesChannelId} is not text-based`)

	const recent = await channel.messages.fetch({ limit: 50 })
	const existing = recent.find(
		(message) =>
			message.author.id === guild.client.user.id &&
			message.components.some((row) =>
				row.components.some((component) => component.customId === CUSTOM_IDS.rulesAgree)
			)
	)

	const payload = buildRulesMessage()
	if (existing) await existing.edit(payload)
	else await channel.send(payload)
}
```

- [ ] **Step 2: Verify by hand against the test guild**

Start the bot, then check `#rules`.
Expected: exactly one bot message with the rules embed and an `I agree` button. Restart the bot and confirm a second message is **not** posted.

- [ ] **Step 3: Commit**

```bash
git add src/discord/components/rules-message.ts
git commit -m "feat: add idempotent persistent rules message"
```

---

### Task 7: Questionnaire components

**Files:**

- Create: `src/discord/components/questionnaire.ts`

**Interfaces:**

- Consumes: `CUSTOM_IDS`, `EXPERIENCE_LEVELS`, `QuestionnaireAnswers`.
- Produces: `buildPurposeModal()`, `buildExperienceSelect()`, `buildBuiltForDiscordButtons()`,
  `nextQuestion(answers): 'purpose' | 'experience' | 'built' | 'done'`.

- [ ] **Step 1: Write `src/discord/components/questionnaire.ts`**

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
	if (answers.builtForDiscord === null) return 'built'
	return 'done'
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/discord/components/questionnaire.ts
git commit -m "feat: add questionnaire component builders"
```

---

### Task 8: Event handlers and interaction routing

**Files:**

- Create: `src/discord/events/guild-member-add.ts`, `src/discord/events/message-create.ts`, `src/discord/events/interaction-create.ts`
- Create: `src/discord/commands/intro.ts`
- Modify: `src/index.ts`

**Interfaces:**

- Consumes: `OnboardingService`, `OnboardingRepository`, `Config`, all component builders.
- Produces: `registerHandlers(client, deps)` wiring every event. `deps` is
  `{ service, repo, config, now }`.

- [ ] **Step 1: Write `src/discord/events/guild-member-add.ts`**

```ts
import type { GuildMember } from 'discord.js'
import type { OnboardingService } from '../../core/onboarding-service.js'

export const handleGuildMemberAdd = async (
	member: GuildMember,
	service: OnboardingService,
	rulesChannelId: string
): Promise<void> => {
	if (member.user.bot) return

	await service.handleJoin(member.id, member.guild.id)

	await member
		.send({
			content: `Welcome to ${member.guild.name}. To get access, head to <#${rulesChannelId}>, agree to the rules, answer three quick questions, and introduce yourself.`
		})
		.catch(() => {
			console.info(JSON.stringify({ level: 'info', event: 'join-dm-skipped', userId: member.id }))
		})
}
```

- [ ] **Step 2: Write `src/discord/events/message-create.ts`**

```ts
import type { Message } from 'discord.js'
import type { OnboardingRepository } from '../../db/onboarding-repository.js'
import type { OnboardingService } from '../../core/onboarding-service.js'

export const handleMessageCreate = async (
	message: Message,
	service: OnboardingService,
	repo: OnboardingRepository,
	introductionsChannelId: string
): Promise<void> => {
	if (message.author.bot) return
	if (message.channelId !== introductionsChannelId) return

	const existing = repo.get(message.author.id)
	if (existing?.introPostedAt) return

	await service.recordStep(message.author.id, 'intro')
	repo.setIntroMessageId(message.author.id, message.id)
}
```

- [ ] **Step 3: Write `src/discord/commands/intro.ts`**

```ts
import {
	MessageFlags,
	SlashCommandBuilder,
	type ChatInputCommandInteraction,
	type RepliableInteraction
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

export const promptNextQuestion = async (
	interaction: RepliableInteraction,
	repo: OnboardingRepository,
	userId: string
): Promise<void> => {
	const step = nextQuestion(repo.getAnswers(userId))

	if (step === 'purpose') {
		if (interaction.isChatInputCommand() || interaction.isButton())
			await interaction.showModal(buildPurposeModal())
		return
	}

	const payload =
		step === 'experience'
			? {
					content: "What's your level of understanding in web/software development?",
					components: [buildExperienceSelect()]
				}
			: step === 'built'
				? {
						content: 'Have you ever developed anything for Discord?',
						components: [buildBuiltForDiscordButtons()]
					}
				: {
						content:
							'You have already answered every question. Post in the introductions channel to finish.',
						components: []
					}

	if (interaction.replied || interaction.deferred)
		await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral })
	else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral })
}

export const handleIntroCommand = async (
	interaction: ChatInputCommandInteraction,
	repo: OnboardingRepository
): Promise<void> => {
	await promptNextQuestion(interaction, repo, interaction.user.id)
}
```

- [ ] **Step 4: Write `src/discord/events/interaction-create.ts`**

```ts
import { MessageFlags, type Interaction } from 'discord.js'
import type { OnboardingService } from '../../core/onboarding-service.js'
import type { OnboardingRepository } from '../../db/onboarding-repository.js'
import type { ExperienceLevel } from '../../types.js'
import { CUSTOM_IDS, parseCustomId } from '../components/custom-ids.js'
import { handleIntroCommand, promptNextQuestion } from '../commands/intro.js'

export type InteractionDeps = {
	readonly service: OnboardingService
	readonly repo: OnboardingRepository
	readonly now: () => string
}

export const handleInteractionCreate = async (
	interaction: Interaction,
	deps: InteractionDeps
): Promise<void> => {
	const { service, repo, now } = deps

	if (interaction.isChatInputCommand() && interaction.commandName === 'intro') {
		await handleIntroCommand(interaction, repo)
		return
	}

	if (interaction.isModalSubmit() && interaction.customId === CUSTOM_IDS.purposeModal) {
		const purpose = interaction.fields.getTextInputValue(CUSTOM_IDS.purposeInput)
		repo.saveAnswer(interaction.user.id, { purpose }, now())
		await interaction.reply({ content: 'Got it.', flags: MessageFlags.Ephemeral })
		await promptNextQuestion(interaction, repo, interaction.user.id)
		return
	}

	if (interaction.isStringSelectMenu() && interaction.customId === CUSTOM_IDS.experienceSelect) {
		const [value] = interaction.values
		repo.saveAnswer(interaction.user.id, { experienceLevel: value as ExperienceLevel }, now())
		await interaction.update({ content: 'Got it.', components: [] })
		await promptNextQuestion(interaction, repo, interaction.user.id)
		return
	}

	if (!interaction.isButton()) return

	const parsed = parseCustomId(interaction.customId)
	if (!parsed) return

	if (parsed.action === 'rules-agree') {
		await service.recordStep(interaction.user.id, 'rules')
		await interaction.reply({
			content: 'Rules accepted. Next: answer three quick questions with `/intro`.',
			flags: MessageFlags.Ephemeral
		})
		await promptNextQuestion(interaction, repo, interaction.user.id)
		return
	}

	if (parsed.action === 'q3') {
		repo.saveAnswer(interaction.user.id, { builtForDiscord: parsed.value === 'yes' }, now())
		await service.recordStep(interaction.user.id, 'questionnaire')
		await interaction.update({
			content: 'Questions done. Last step: introduce yourself in the introductions channel.',
			components: []
		})
	}
}
```

- [ ] **Step 5: Wire everything into `src/index.ts`**

Inside the existing `ClientReady` handler, after `preflight-passed`:

```ts
const guild = await ready.guilds.fetch(config.guildId)
const port = createDiscordPort(guild, config.modLogChannelId)
const service = createOnboardingService({
	repo,
	port,
	verifiedRoleId: config.verifiedRoleId,
	unverifiedRoleId: config.unverifiedRoleId,
	now: () => new Date().toISOString()
})

await ensureRulesMessage(guild, config.rulesChannelId)
await guild.commands.set([introCommand.toJSON()])
await reconcile({
	guild,
	repo,
	service,
	verifiedRoleId: config.verifiedRoleId,
	unverifiedRoleId: config.unverifiedRoleId,
	port
})

client.on(Events.GuildMemberAdd, (member) =>
	handleGuildMemberAdd(member, service, config.rulesChannelId)
)
client.on(Events.MessageCreate, (message) =>
	handleMessageCreate(message, service, repo, config.introductionsChannelId)
)
client.on(Events.InteractionCreate, (interaction) =>
	handleInteractionCreate(interaction, { service, repo, now: () => new Date().toISOString() })
)
```

Add the matching imports at the top of the file.

- [ ] **Step 6: Walk the whole flow by hand**

With the bot running against the test guild, using a second account: join, click `I agree`, answer all three questions, post in `#introductions`.
Expected: `unverified` on join; `verified` appears and `unverified` disappears immediately after the intro post; an audit embed lands in the mod channel.

- [ ] **Step 7: Commit**

```bash
git add src/discord src/index.ts
git commit -m "feat: wire up rules, questionnaire, and intro handlers"
```

---

### Task 9: Startup reconciliation

**Files:**

- Create: `src/tasks/reconcile.ts`
- Test: `tests/tasks/reconcile.test.ts`

**Interfaces:**

- Consumes: `OnboardingRepository`, `OnboardingService`, `DiscordPort`.
- Produces: `reconcileMembers(deps, members): Promise<ReconcileSummary>` where `members` is a plain
  array of `{ userId, isBot, roleIds }`. The discord.js-facing wrapper `reconcile({ guild, ... })`
  maps the guild member list into that shape, keeping the logic testable without a gateway.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createOnboardingRepository } from '../../src/db/onboarding-repository.js'
import { createOnboardingService } from '../../src/core/onboarding-service.js'
import { reconcileMembers } from '../../src/tasks/reconcile.js'
import { createFakeDiscordPort } from '../helpers/fake-discord-port.js'
import { createTestDb } from '../helpers/test-db.js'

const GUILD = '123456789012345678'
const VERIFIED = '423456789012345678'
const UNVERIFIED = '523456789012345678'
const AT = '2026-08-08T10:00:00.000Z'

let repo: ReturnType<typeof createOnboardingRepository>
let fake: ReturnType<typeof createFakeDiscordPort>
let deps: Parameters<typeof reconcileMembers>[0]

beforeEach(() => {
	repo = createOnboardingRepository(createTestDb())
	fake = createFakeDiscordPort()
	const service = createOnboardingService({
		repo,
		port: fake.port,
		verifiedRoleId: VERIFIED,
		unverifiedRoleId: UNVERIFIED,
		now: () => AT
	})
	deps = {
		repo,
		service,
		port: fake.port,
		guildId: GUILD,
		verifiedRoleId: VERIFIED,
		unverifiedRoleId: UNVERIFIED
	}
})

describe('reconcileMembers', () => {
	it('creates a record and applies unverified for a member who joined during downtime', async () => {
		await reconcileMembers(deps, [{ userId: 'u1', isBot: false, roleIds: [] }])
		expect(repo.get('u1')).not.toBeNull()
		expect(fake.addedRoles).toContainEqual({ userId: 'u1', roleId: UNVERIFIED })
	})

	it('skips bots entirely', async () => {
		await reconcileMembers(deps, [{ userId: 'bot', isBot: true, roleIds: [] }])
		expect(repo.get('bot')).toBeNull()
		expect(fake.addedRoles).toHaveLength(0)
	})

	it('re-applies a missing verified role', async () => {
		repo.upsertOnJoin('u2', GUILD, AT)
		repo.markVerified('u2', AT)
		await reconcileMembers(deps, [{ userId: 'u2', isBot: false, roleIds: [] }])
		expect(fake.addedRoles).toContainEqual({ userId: 'u2', roleId: VERIFIED })
	})

	it('strips the verified role from a held member', async () => {
		repo.upsertOnJoin('u3', GUILD, AT)
		repo.setHold('u3', AT, 'mod')
		await reconcileMembers(deps, [{ userId: 'u3', isBot: false, roleIds: [VERIFIED] }])
		expect(fake.removedRoles).toContainEqual({ userId: 'u3', roleId: VERIFIED })
	})

	it('grants verified to a member who completed every step while the bot was offline', async () => {
		repo.upsertOnJoin('u4', GUILD, AT)
		for (const step of ['rules', 'questionnaire', 'intro'] as const) repo.stampStep('u4', step, AT)
		await reconcileMembers(deps, [{ userId: 'u4', isBot: false, roleIds: [UNVERIFIED] }])
		expect(fake.addedRoles).toContainEqual({ userId: 'u4', roleId: VERIFIED })
	})

	it('reports an anomaly for someone holding verified with no record of earning it', async () => {
		await reconcileMembers(deps, [{ userId: 'u5', isBot: false, roleIds: [VERIFIED] }])
		expect(fake.audits.some((entry) => entry.kind === 'reconcile-anomaly')).toBe(true)
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
import type { OnboardingService } from '../core/onboarding-service.js'
import type { OnboardingRepository } from '../db/onboarding-repository.js'

export type ReconcileMember = {
	readonly userId: string
	readonly isBot: boolean
	readonly roleIds: readonly string[]
}

export type ReconcileDeps = {
	readonly repo: OnboardingRepository
	readonly service: OnboardingService
	readonly port: DiscordPort
	readonly guildId: string
	readonly verifiedRoleId: string
	readonly unverifiedRoleId: string
}

export type ReconcileSummary = {
	created: number
	rolesRestored: number
	holdsEnforced: number
	granted: number
	anomalies: number
}

export const reconcileMembers = async (
	deps: ReconcileDeps,
	members: readonly ReconcileMember[]
): Promise<ReconcileSummary> => {
	const summary: ReconcileSummary = {
		created: 0,
		rolesRestored: 0,
		holdsEnforced: 0,
		granted: 0,
		anomalies: 0
	}

	for (const member of members) {
		if (member.isBot) continue

		const record = deps.repo.get(member.userId)
		const hasVerifiedRole = member.roleIds.includes(deps.verifiedRoleId)

		if (!record) {
			if (hasVerifiedRole) {
				summary.anomalies += 1
				await deps.port.postAudit({
					kind: 'reconcile-anomaly',
					userId: member.userId,
					detail: 'Holds the verified role but has no onboarding record. Left unchanged for review.'
				})
				continue
			}
			await deps.service.handleJoin(member.userId, deps.guildId)
			summary.created += 1
			continue
		}

		if (record.verificationHoldAt) {
			if (hasVerifiedRole) {
				await deps.port.removeRole(member.userId, deps.verifiedRoleId)
				await deps.port.addRole(member.userId, deps.unverifiedRoleId)
				summary.holdsEnforced += 1
			}
			continue
		}

		if (record.verifiedAt) {
			if (!hasVerifiedRole) {
				await deps.port.addRole(member.userId, deps.verifiedRoleId)
				await deps.port.removeRole(member.userId, deps.unverifiedRoleId)
				summary.rolesRestored += 1
			}
			continue
		}

		if (record.rulesAcceptedAt && record.questionnaireCompletedAt && record.introPostedAt) {
			await deps.service.grantVerified(record)
			summary.granted += 1
			continue
		}

		if (hasVerifiedRole) {
			summary.anomalies += 1
			await deps.port.postAudit({
				kind: 'reconcile-anomaly',
				userId: member.userId,
				detail: 'Holds the verified role without completing onboarding. Left unchanged for review.'
			})
		}
	}

	return summary
}

export const reconcile = async (
	deps: ReconcileDeps & { guild: Guild }
): Promise<ReconcileSummary> => {
	const members = await deps.guild.members.fetch()
	const summary = await reconcileMembers(
		deps,
		members.map((member) => ({
			userId: member.id,
			isBot: member.user.bot,
			roleIds: [...member.roles.cache.keys()]
		}))
	)
	console.info(JSON.stringify({ level: 'info', event: 'reconcile-complete', ...summary }))
	return summary
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test tests/tasks/reconcile.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify against the test guild**

Stop the bot, join with a second account, restart the bot.
Expected: a `reconcile-complete` log line with `created: 1`, and the account now has `unverified`.

- [ ] **Step 6: Commit**

```bash
git add src/tasks/reconcile.ts tests/tasks/reconcile.test.ts
git commit -m "feat: add startup reconciliation for offline drift"
```

## Acceptance Criteria

- A new member receives `unverified` within seconds of joining
- Clicking `I agree` in `#rules` stamps the step and immediately offers question 1
- The questionnaire can be abandoned and resumed later with `/intro` at the correct question
- Posting any message in `#introductions` completes the final step
- `verified` is granted and `unverified` removed only when all three steps are done
- Completing steps in a non-standard order (intro first) still verifies correctly
- A held member never receives `verified`, no matter which steps complete afterwards
- Restarting the bot posts no duplicate rules message
- A member who joined while the bot was offline is given `unverified` on the next boot
- `pnpm test` passes; `src/core/` contains no `discord.js` import

## UI/UX Pattern

_N/A — no web UI surface. All member interaction uses native Discord modals, select menus, and buttons._

## Open Questions

- [ ] None.

## Dependencies

- Requires: [[01-bot-foundation]]
- Blocks: `03-reminders-and-mod-tooling` (removed)

## Decisions

- 2026-08-08 — `reconcileMembers` takes a plain array rather than a discord.js collection so the drift logic is testable without a gateway connection; `reconcile` is the thin mapping wrapper.
- 2026-08-08 — The welcome DM is sent after the role grant and its failure is ignored, so a member with closed DMs still gets verified.
- 2026-08-08 — `#introductions` messages are matched on author and channel only. No content inspection, which is what keeps the `MessageContent` intent unnecessary.
