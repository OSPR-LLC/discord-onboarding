---
plan: reminders-and-mod-tooling
project: discord-developer
updated: 2026-08-08
status: 🔵 Planning
tags: [plan]
---

# 03 — Reminders & moderator tooling

> ⚠️ **SUPERSEDED — archived 2026-08-10.** This is the single-guild draft, replaced by the
> multi-guild rework. Do not implement from this file. The current plans are
> [[01-bot-foundation]], [[02-guild-configuration]], [[03-verification-gate]] and
> [[04-reminders-and-mod-tooling]]. Kept only for history.

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md`](../docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md)

## Status

🔵 Planning

## Goal

> Members who stall partway through onboarding get up to two reminder DMs and are then left alone — never kicked. Moderators can inspect any member's progress, force-verify, place a hold, or wipe a record entirely, all through one `/onboarding` command restricted to staff.

## Global Constraints

Inherits every constraint from [[01-bot-foundation]] and `02-verification-gate` (removed). Additionally:

- **This bot never kicks or bans anyone.** No task here may add such a capability.
- Elapsed-time logic takes an injected clock. No test may call `sleep` or depend on the real time.
- Moderator commands mutate state only through `OnboardingService`, never by writing roles directly.

## File Structure

| File                                 | Responsibility                                                  |
| ------------------------------------ | --------------------------------------------------------------- |
| `src/tasks/reminder-sweep.ts`        | Selects who is due a reminder and sends it                      |
| `src/discord/commands/onboarding.ts` | The `/onboarding` command and its four subcommands              |
| `src/index.ts`                       | (modified) registers the command and starts the hourly interval |

---

### Task 1: Reminder sweep

**Files:**

- Create: `src/tasks/reminder-sweep.ts`
- Test: `tests/tasks/reminder-sweep.test.ts`

**Interfaces:**

- Consumes: `OnboardingRepository.listAwaitingReminder / incrementReminder` (plan 01 task 5), `DiscordPort.sendDm`.
- Produces: `runReminderSweep(deps): Promise<number>` returning how many reminders were sent, plus the exported constants `FIRST_REMINDER_MS` and `SECOND_REMINDER_MS`.
- `deps` is `{ repo, port, now }` where `now: () => Date`.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createOnboardingRepository } from '../../src/db/onboarding-repository.js'
import { runReminderSweep } from '../../src/tasks/reminder-sweep.js'
import { createFakeDiscordPort } from '../helpers/fake-discord-port.js'
import { createTestDb } from '../helpers/test-db.js'

const GUILD = '123456789012345678'
const USER = '223456789012345678'
const JOINED = '2026-08-08T10:00:00.000Z'

const hoursAfterJoin = (hours: number) => new Date(Date.parse(JOINED) + hours * 60 * 60 * 1000)

let repo: ReturnType<typeof createOnboardingRepository>
let fake: ReturnType<typeof createFakeDiscordPort>
let clock: Date

const sweep = () => runReminderSweep({ repo, port: fake.port, now: () => clock })

beforeEach(() => {
	repo = createOnboardingRepository(createTestDb())
	fake = createFakeDiscordPort()
	repo.upsertOnJoin(USER, GUILD, JOINED)
	clock = hoursAfterJoin(0)
})

describe('runReminderSweep', () => {
	it('sends nothing before the first threshold', async () => {
		clock = hoursAfterJoin(23)
		expect(await sweep()).toBe(0)
		expect(fake.dms).toHaveLength(0)
	})

	it('sends the first reminder once 24 hours have elapsed', async () => {
		clock = hoursAfterJoin(24)
		expect(await sweep()).toBe(1)
		expect(repo.get(USER)?.remindersSent).toBe(1)
	})

	it('does not send a second reminder before 72 hours', async () => {
		clock = hoursAfterJoin(24)
		await sweep()
		clock = hoursAfterJoin(48)
		expect(await sweep()).toBe(0)
	})

	it('sends the second reminder once 72 hours have elapsed', async () => {
		clock = hoursAfterJoin(24)
		await sweep()
		clock = hoursAfterJoin(72)
		expect(await sweep()).toBe(1)
		expect(repo.get(USER)?.remindersSent).toBe(2)
	})

	it('stops permanently after the second reminder', async () => {
		clock = hoursAfterJoin(24)
		await sweep()
		clock = hoursAfterJoin(72)
		await sweep()
		clock = hoursAfterJoin(500)
		expect(await sweep()).toBe(0)
	})

	it('never contacts a verified member', async () => {
		repo.markVerified(USER, JOINED)
		clock = hoursAfterJoin(24)
		expect(await sweep()).toBe(0)
	})

	it('never contacts a held member', async () => {
		repo.setHold(USER, JOINED, 'mod')
		clock = hoursAfterJoin(24)
		expect(await sweep()).toBe(0)
	})

	it('counts a reminder as sent even when the member has DMs closed', async () => {
		fake.failDmFor(USER)
		clock = hoursAfterJoin(24)
		await sweep()
		expect(repo.get(USER)?.remindersSent).toBe(1)
	})

	it('names the steps the member still has outstanding', async () => {
		repo.stampStep(USER, 'rules', JOINED)
		clock = hoursAfterJoin(24)
		await sweep()
		const body = fake.dms[0]?.content.body ?? ''
		expect(body).not.toMatch(/agree to the rules/i)
		expect(body).toMatch(/questionnaire/i)
		expect(body).toMatch(/introduce/i)
	})
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test tests/tasks/reminder-sweep.test.ts`
Expected: FAIL — cannot resolve `reminder-sweep.js`.

- [ ] **Step 3: Write `src/tasks/reminder-sweep.ts`**

```ts
import type { DiscordPort } from '../core/discord-port.js'
import type { OnboardingRepository } from '../db/onboarding-repository.js'
import type { OnboardingRecord } from '../types.js'

export const FIRST_REMINDER_MS = 24 * 60 * 60 * 1000
export const SECOND_REMINDER_MS = 72 * 60 * 60 * 1000

export type ReminderDeps = {
	readonly repo: OnboardingRepository
	readonly port: DiscordPort
	readonly now: () => Date
}

const outstandingSteps = (record: OnboardingRecord): string[] => {
	const steps: string[] = []
	if (!record.rulesAcceptedAt) steps.push('agree to the rules in the rules channel')
	if (!record.questionnaireCompletedAt) steps.push('finish the questionnaire with `/intro`')
	if (!record.introPostedAt) steps.push('introduce yourself in the introductions channel')
	return steps
}

export const runReminderSweep = async (deps: ReminderDeps): Promise<number> => {
	const now = deps.now()
	const due = deps.repo.listAwaitingReminder(now.getTime(), FIRST_REMINDER_MS, SECOND_REMINDER_MS)

	let sent = 0

	for (const record of due) {
		const steps = outstandingSteps(record)
		if (steps.length === 0) continue

		// The counter is incremented whether or not the DM lands. A member with closed
		// DMs would otherwise be selected by every future sweep, forever.
		await deps.port.sendDm(record.userId, {
			title: 'Finish setting up your access',
			body: `You still need to:\n${steps.map((step) => `• ${step}`).join('\n')}`
		})

		deps.repo.incrementReminder(record.userId, now.toISOString())
		sent += 1
	}

	if (sent > 0) console.info(JSON.stringify({ level: 'info', event: 'reminder-sweep', sent }))

	return sent
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test tests/tasks/reminder-sweep.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/tasks/reminder-sweep.ts tests/tasks/reminder-sweep.test.ts
git commit -m "feat: add reminder sweep with capped nudges"
```

---

### Task 2: The `/onboarding` moderator command

**Files:**

- Create: `src/discord/commands/onboarding.ts`

**Interfaces:**

- Consumes: `OnboardingService` (`applyHold`, `liftHoldAndVerify`, `resetMember`), `OnboardingRepository` (`get`, `getAnswers`).
- Produces: `onboardingCommand` (the `SlashCommandBuilder`) and
  `handleOnboardingCommand(interaction, deps)` where `deps` is `{ service, repo }`.

- [ ] **Step 1: Write `src/discord/commands/onboarding.ts`**

```ts
import {
	EmbedBuilder,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
	type ChatInputCommandInteraction
} from 'discord.js'
import type { OnboardingService } from '../../core/onboarding-service.js'
import type { OnboardingRepository } from '../../db/onboarding-repository.js'
import type { OnboardingRecord } from '../../types.js'

export const onboardingCommand = new SlashCommandBuilder()
	.setName('onboarding')
	.setDescription('Inspect and manage member onboarding')
	.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
	.addSubcommand((sub) =>
		sub
			.setName('status')
			.setDescription("Show a member's onboarding progress")
			.addUserOption((option) =>
				option.setName('member').setDescription('The member to inspect').setRequired(true)
			)
	)
	.addSubcommand((sub) =>
		sub
			.setName('verify')
			.setDescription('Force-verify a member, lifting any hold')
			.addUserOption((option) =>
				option.setName('member').setDescription('The member to verify').setRequired(true)
			)
	)
	.addSubcommand((sub) =>
		sub
			.setName('unverify')
			.setDescription('Remove verification and place a hold')
			.addUserOption((option) =>
				option.setName('member').setDescription('The member to unverify').setRequired(true)
			)
	)
	.addSubcommand((sub) =>
		sub
			.setName('reset')
			.setDescription('Wipe a member record so they redo onboarding from scratch')
			.addUserOption((option) =>
				option.setName('member').setDescription('The member to reset').setRequired(true)
			)
	)

export type OnboardingCommandDeps = {
	readonly service: OnboardingService
	readonly repo: OnboardingRepository
}

const stepField = (label: string, at: string | null) => ({
	name: label,
	value: at ? `✅ ${at}` : '⬜ not done',
	inline: false
})

const buildStatusEmbed = (
	userId: string,
	record: OnboardingRecord,
	repo: OnboardingRepository
): EmbedBuilder => {
	const answers = repo.getAnswers(userId)

	const embed = new EmbedBuilder()
		.setTitle('Onboarding status')
		.setDescription(`<@${userId}>`)
		.addFields(
			stepField('1. Rules accepted', record.rulesAcceptedAt),
			stepField('2. Questionnaire completed', record.questionnaireCompletedAt),
			stepField('3. Posted in introductions', record.introPostedAt),
			stepField('Verified', record.verifiedAt)
		)

	if (record.verificationHoldAt)
		embed.addFields({
			name: '⛔ Hold',
			value: `Applied ${record.verificationHoldAt} by <@${record.verificationHoldBy ?? 'unknown'}>`
		})

	if (answers)
		embed.addFields(
			{ name: 'Purpose', value: answers.purpose ?? '—' },
			{ name: 'Experience', value: answers.experienceLevel ?? '—', inline: true },
			{
				name: 'Built for Discord',
				value: answers.builtForDiscord === null ? '—' : answers.builtForDiscord ? 'Yes' : 'No',
				inline: true
			}
		)

	return embed
}

export const handleOnboardingCommand = async (
	interaction: ChatInputCommandInteraction,
	deps: OnboardingCommandDeps
): Promise<void> => {
	const target = interaction.options.getUser('member', true)
	const subcommand = interaction.options.getSubcommand()

	if (subcommand === 'status') {
		const record = deps.repo.get(target.id)
		await interaction.reply({
			content: record ? undefined : `<@${target.id}> has no onboarding record.`,
			embeds: record ? [buildStatusEmbed(target.id, record, deps.repo)] : [],
			flags: MessageFlags.Ephemeral
		})
		return
	}

	if (subcommand === 'verify') {
		await deps.service.liftHoldAndVerify(target.id, interaction.user.id)
		await interaction.reply({
			content: `<@${target.id}> is now verified.`,
			flags: MessageFlags.Ephemeral
		})
		return
	}

	if (subcommand === 'unverify') {
		await deps.service.applyHold(target.id, interaction.user.id)
		await interaction.reply({
			content: `<@${target.id}> is unverified and on hold. Their completed steps are kept; use \`/onboarding verify\` to lift the hold.`,
			flags: MessageFlags.Ephemeral
		})
		return
	}

	if (subcommand === 'reset') {
		await deps.service.resetMember(target.id)
		await interaction.reply({
			content: `<@${target.id}>'s record is wiped. They will go through onboarding from the start.`,
			flags: MessageFlags.Ephemeral
		})
	}
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/discord/commands/onboarding.ts
git commit -m "feat: add /onboarding moderator command"
```

---

### Task 3: Register the command and start the sweep

**Files:**

- Modify: `src/index.ts`
- Modify: `src/discord/events/interaction-create.ts`

- [ ] **Step 1: Route the command in `interaction-create.ts`**

Add to `InteractionDeps`:

```ts
export type InteractionDeps = {
	readonly service: OnboardingService
	readonly repo: OnboardingRepository
	readonly now: () => string
}
```

and immediately after the existing `/intro` branch:

```ts
if (interaction.isChatInputCommand() && interaction.commandName === 'onboarding') {
	await handleOnboardingCommand(interaction, { service, repo })
	return
}
```

with the matching import.

- [ ] **Step 2: Register both commands in `src/index.ts`**

Replace the existing single-command registration:

```ts
await guild.commands.set([introCommand.toJSON(), onboardingCommand.toJSON()])
```

- [ ] **Step 3: Start the hourly sweep in `src/index.ts`**

After reconciliation completes:

```ts
const HOUR_MS = 60 * 60 * 1000

const sweep = () =>
	runReminderSweep({ repo, port, now: () => new Date() }).catch((error: unknown) => {
		console.error(
			JSON.stringify({ level: 'error', event: 'reminder-sweep-failed', error: String(error) })
		)
	})

await sweep()
const sweepTimer = setInterval(sweep, HOUR_MS)
sweepTimer.unref()
```

Add `clearInterval(sweepTimer)` to the existing `shutdown` function.

- [ ] **Step 4: Verify the full suite still passes**

Run: `pnpm test && pnpm typecheck`
Expected: every test green, no type errors.

- [ ] **Step 5: Verify the moderator commands by hand**

Against the test guild, as a user with Manage Roles, on a verified second account:

1. `/onboarding status @member` — shows three ticks and a verified timestamp
2. `/onboarding unverify @member` — role is removed, status now shows a hold
3. Have that account post again in `#introductions` — they must **not** be re-verified
4. `/onboarding verify @member` — hold lifted, role restored
5. `/onboarding reset @member` — status reports no record, member holds `unverified`

Then confirm a non-staff account cannot see the command at all.

- [ ] **Step 6: Update the README**

Add a **Moderator commands** section documenting the four subcommands, that they require Manage Roles, and the difference between `unverify` (keeps history, blocks re-verification via a hold) and `reset` (wipes everything).

- [ ] **Step 7: Commit**

```bash
git add src/index.ts src/discord/events/interaction-create.ts README.md
git commit -m "feat: register moderator command and hourly reminder sweep"
```

## Acceptance Criteria

- A member who stalls receives exactly two reminder DMs, at roughly 24h and 72h, then nothing further
- A member with closed DMs is not retried on every subsequent sweep
- Verified and held members are never sent reminders
- Reminder text lists only the steps that member has actually left undone
- No code path in the project kicks or bans a member
- `/onboarding` is invisible to members without Manage Roles
- `/onboarding unverify` survives a subsequent step event — the member stays unverified
- `/onboarding reset` removes the record and returns the member to `unverified`
- `pnpm test` passes with the full suite green

## UI/UX Pattern

_N/A — no web UI surface._

## Open Questions

- [ ] None.

## Dependencies

- Requires: `02-verification-gate` (removed)
- Blocks: —

## Decisions

- 2026-08-08 — `reminders_sent` increments even when the DM fails. Without this, a member with closed DMs is selected by every sweep forever and the audit log fills with identical failures.
- 2026-08-08 — The sweep timer is `unref()`d so it never keeps the process alive on its own during shutdown.
- 2026-08-08 — `unverify` sets a hold rather than clearing step timestamps, keeping the member's history intact for review while still blocking re-verification.
