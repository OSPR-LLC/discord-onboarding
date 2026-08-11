---
plan: reminders-and-mod-tooling
project: discord-developer
updated: 2026-08-11
status: 🟡 In Progress
tags: [plan]
---

# 04 — Reminders & moderator tooling

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md`](../docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md)

## Status

🟡 In Progress

## Goal

> Members who stall partway through onboarding get up to two reminder DMs across every enabled server, then are left alone — never kicked. Moderators in any server can inspect a member's progress, force-verify, place a hold, or wipe a record, through one `/onboarding` command restricted to staff.

## Global Constraints

Inherits every constraint from [[01-bot-foundation]], [[02-guild-configuration]] and [[03-verification-gate]]. Additionally:

- **This bot never kicks or bans anyone.** No task here may add such a capability.
- Elapsed-time logic takes an injected clock. No test may call `sleep` or read the real time.
- Moderator commands mutate state only through `OnboardingService`, never by writing roles directly.
- The sweep must process guilds independently: one guild's failure cannot stop the others.

## File Structure

| File                                 | Responsibility                                                  |
| ------------------------------------ | --------------------------------------------------------------- |
| `src/tasks/reminder-sweep.ts`        | Selects who is due a reminder, per guild, and sends it          |
| `src/discord/commands/onboarding.ts` | The `/onboarding` command and its four subcommands              |
| `src/index.ts`                       | (modified) registers the command and starts the hourly interval |

---

### Task 1: Reminder sweep

**Files:**

- Create: `src/tasks/reminder-sweep.ts`
- Test: `tests/tasks/reminder-sweep.test.ts`

**Interfaces:**

- Consumes: `OnboardingRepository.listAwaitingReminder / incrementReminder`, `DiscordPort.sendDm`, `GuildConfigRepository.listEnabled`, `resolveGuildConfig`.
- Produces: `runGuildReminderSweep(deps, config): Promise<number>`, `runReminderSweep(deps): Promise<number>`, and the constants `FIRST_REMINDER_MS` / `SECOND_REMINDER_MS`.
- `deps` is `{ guildConfig, repo, port, now }` where `now: () => Date`.

- [x] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { ResolvedGuildConfig } from '../../src/core/guild-config.js'
import { createOnboardingRepository } from '../../src/db/onboarding-repository.js'
import { runGuildReminderSweep } from '../../src/tasks/reminder-sweep.js'
import { createFakeDiscordPort } from '../helpers/fake-discord-port.js'
import { createTestDb } from '../helpers/test-db.js'

const GUILD = '123456789012345678'
const USER = '223456789012345678'
const JOINED = '2026-08-10T10:00:00.000Z'
const HOUR = 60 * 60 * 1000

const config: ResolvedGuildConfig = {
	guildId: GUILD,
	rulesChannelId: '1',
	introductionsChannelId: '2',
	modLogChannelId: '3',
	verifiedRoleId: '4',
	unverifiedRoleId: '5',
	rulesText: 'rules',
	rulesMessageId: null,
	grandfatherBefore: null
}

const hoursAfterJoin = (hours: number) => new Date(Date.parse(JOINED) + hours * HOUR)

let repo: ReturnType<typeof createOnboardingRepository>
let fake: ReturnType<typeof createFakeDiscordPort>
let clock: Date

const sweep = () => runGuildReminderSweep({ repo, port: fake.port, now: () => clock }, config)

beforeEach(() => {
	repo = createOnboardingRepository(createTestDb())
	fake = createFakeDiscordPort()
	repo.upsertOnJoin(GUILD, USER, JOINED)
	clock = hoursAfterJoin(0)
})

describe('runGuildReminderSweep', () => {
	it('sends nothing before the first threshold', async () => {
		clock = hoursAfterJoin(23)
		expect(await sweep()).toBe(0)
		expect(fake.dms).toHaveLength(0)
	})

	it('sends the first reminder once 24 hours have elapsed', async () => {
		clock = hoursAfterJoin(24)
		expect(await sweep()).toBe(1)
		expect(repo.get(GUILD, USER)?.remindersSent).toBe(1)
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
		expect(repo.get(GUILD, USER)?.remindersSent).toBe(2)
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
		repo.markVerified(GUILD, USER, JOINED)
		clock = hoursAfterJoin(24)
		expect(await sweep()).toBe(0)
	})

	it('never contacts a held member', async () => {
		repo.setHold(GUILD, USER, JOINED, 'mod')
		clock = hoursAfterJoin(24)
		expect(await sweep()).toBe(0)
	})

	it('counts a reminder as sent even when the member has DMs closed', async () => {
		fake.failDmFor(USER)
		clock = hoursAfterJoin(24)
		await sweep()
		expect(repo.get(GUILD, USER)?.remindersSent).toBe(1)
	})

	it('names only the steps the member still has outstanding', async () => {
		repo.stampStep(GUILD, USER, 'rules', JOINED)
		clock = hoursAfterJoin(24)
		await sweep()

		const body = fake.dms[0]?.content.body ?? ''
		expect(body).not.toMatch(/agree to the rules/i)
		expect(body).toMatch(/questionnaire/i)
		expect(body).toMatch(/introduce/i)
	})

	it('advances the counter for a member with nothing outstanding rather than reselecting them forever', async () => {
		for (const step of ['rules', 'questionnaire', 'intro'] as const)
			repo.stampStep(GUILD, USER, step, JOINED)

		clock = hoursAfterJoin(24)
		await sweep()

		expect(fake.dms).toHaveLength(0)
		expect(repo.get(GUILD, USER)?.remindersSent).toBe(1)
	})

	it('does not touch members belonging to another guild', async () => {
		const otherGuild = '923456789012345678'
		repo.upsertOnJoin(otherGuild, USER, JOINED)
		clock = hoursAfterJoin(24)

		await sweep()

		expect(repo.get(otherGuild, USER)?.remindersSent).toBe(0)
	})
})
```

- [x] **Step 2: Run it to confirm it fails**

Run: `pnpm test tests/tasks/reminder-sweep.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Write `src/tasks/reminder-sweep.ts`**

```ts
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
```

- [x] **Step 4: Run the test to confirm it passes**

Run: `pnpm test tests/tasks/reminder-sweep.test.ts`
Expected: PASS, 11 tests.

- [x] **Step 5: Commit**

```bash
git add src/tasks/reminder-sweep.ts tests/tasks/reminder-sweep.test.ts
git commit -m "feat: add multi-guild reminder sweep"
```

---

### Task 2: The `/onboarding` moderator command

**Files:**

- Create: `src/discord/commands/onboarding.ts`

**Interfaces:**

- Consumes: `OnboardingService` (`applyHold`, `liftHoldAndVerify`, `resetMember`), `OnboardingRepository`, `resolveActiveConfig`.
- Produces: `onboardingCommand` and `handleOnboardingCommand(interaction, deps)` where `deps` is `{ guildConfig, repo, service }`.

- [x] **Step 1: Write `src/discord/commands/onboarding.ts`**

Note the `status` reply builds its payload in two branches rather than passing `content: undefined`, which `exactOptionalPropertyTypes` rejects.

```ts
import {
	EmbedBuilder,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
	type ChatInputCommandInteraction
} from 'discord.js'
import type { OnboardingService } from '../../core/onboarding-service.js'
import type { GuildConfigRepository } from '../../db/guild-config-repository.js'
import type { OnboardingRepository } from '../../db/onboarding-repository.js'
import type { OnboardingRecord } from '../../types.js'
import { resolveActiveConfig } from '../resolve-active-config.js'

export const onboardingCommand = new SlashCommandBuilder()
	.setName('onboarding')
	.setDescription('Inspect and manage member onboarding')
	.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
	.setDMPermission(false)
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
			.setDescription('Wipe a member record so they redo onboarding')
			.addUserOption((option) =>
				option.setName('member').setDescription('The member to reset').setRequired(true)
			)
	)

export type OnboardingCommandDeps = {
	readonly guildConfig: GuildConfigRepository
	readonly repo: OnboardingRepository
	readonly service: OnboardingService
}

const ephemeral = { flags: MessageFlags.Ephemeral } as const

const stepField = (name: string, at: string | null) => ({
	name,
	value: at ? `✅ ${at}` : '⬜ not done',
	inline: false
})

const buildStatusEmbed = (
	guildId: string,
	userId: string,
	record: OnboardingRecord,
	repo: OnboardingRepository
): EmbedBuilder => {
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

	const answers = repo.getAnswers(guildId, userId)
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
	if (!interaction.guildId) return

	const config = resolveActiveConfig(deps.guildConfig, interaction.guildId)
	if (!config) {
		await interaction.reply({
			content:
				'Onboarding is not set up in this server yet. An admin can configure it with `/config`.',
			...ephemeral
		})
		return
	}

	const target = interaction.options.getUser('member', true)
	const subcommand = interaction.options.getSubcommand()

	if (subcommand === 'status') {
		const record = deps.repo.get(config.guildId, target.id)

		// Built in two branches: passing `content: undefined` is a type error
		// under exactOptionalPropertyTypes.
		await interaction.reply(
			record
				? { embeds: [buildStatusEmbed(config.guildId, target.id, record, deps.repo)], ...ephemeral }
				: { content: `<@${target.id}> has no onboarding record in this server.`, ...ephemeral }
		)
		return
	}

	if (subcommand === 'verify') {
		await deps.service.liftHoldAndVerify(config, target.id, interaction.user.id)
		await interaction.reply({ content: `<@${target.id}> is now verified.`, ...ephemeral })
		return
	}

	if (subcommand === 'unverify') {
		await deps.service.applyHold(config, target.id, interaction.user.id)
		await interaction.reply({
			content: `<@${target.id}> is unverified and on hold. Their completed steps are kept — use \`/onboarding verify\` to lift the hold.`,
			...ephemeral
		})
		return
	}

	if (subcommand === 'reset') {
		await deps.service.resetMember(config, target.id)
		await interaction.reply({
			content: `<@${target.id}>'s record is wiped. They will go through onboarding from the start.`,
			...ephemeral
		})
	}
}
```

- [x] **Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: no errors.

- [x] **Step 3: Commit**

```bash
git add src/discord/commands/onboarding.ts
git commit -m "feat: add /onboarding moderator command"
```

---

### Task 3: Register the command and start the sweep

**Files:**

- Modify: `src/discord/register-commands.ts`, `src/discord/events/interaction-create.ts`, `src/index.ts`

- [ ] **Step 1: Add the command to registration**

In `src/discord/register-commands.ts`, extend the array:

```ts
const commands = [configCommand.toJSON(), introCommand.toJSON(), onboardingCommand.toJSON()]
```

- [ ] **Step 2: Route the command**

In `src/discord/events/interaction-create.ts`, add a branch immediately after the `/intro` branch. `handleOnboardingCommand` resolves config itself and replies helpfully when the guild is inactive, so no `resolveActiveConfig` guard is needed here:

```ts
if (interaction.isChatInputCommand() && interaction.commandName === 'onboarding') {
	await handleOnboardingCommand(interaction, { guildConfig, repo, service })
	return
}
```

Add the import.

- [ ] **Step 3: Start the hourly sweep in `src/index.ts`**

After reconciliation:

```ts
const HOUR_MS = 60 * 60 * 1000

const sweep = (): void => {
	void runReminderSweep({
		guildConfig,
		repo: onboarding,
		port,
		now: () => new Date()
	}).catch((error: unknown) => {
		console.error(
			JSON.stringify({
				level: 'error',
				event: 'reminder-sweep-failed',
				error: error instanceof Error ? error.message : String(error)
			})
		)
	})
}

sweep()
const sweepTimer = setInterval(sweep, HOUR_MS)
sweepTimer.unref()
```

Add `clearInterval(sweepTimer)` to `shutdown`. Because `sweepTimer` is created inside the `ClientReady` handler, hoist it to module scope as `let sweepTimer: NodeJS.Timeout | undefined` and guard the clear with `if (sweepTimer) clearInterval(sweepTimer)`.

- [ ] **Step 4: Verify the full suite**

Run: `pnpm test && pnpm typecheck`
Expected: every test green, no type errors.

- [ ] **Step 5: Verify the moderator commands by hand**

Against a throwaway guild, as a user with Manage Roles, targeting a verified second account:

1. `/onboarding status` — three ticks and a verified timestamp
2. `/onboarding unverify` — role removed; status now shows a hold
3. Have that account post again in the introductions channel — they must **not** be re-verified
4. `/onboarding verify` — hold lifted, role restored
5. `/onboarding reset` — status reports no record, member holds `unverified`
6. `/onboarding status` against a member the bot has never seen — reports no record rather than erroring

Then confirm a non-staff account cannot see the command, and that `/onboarding status` in a disabled server explains onboarding is not set up.

- [ ] **Step 6: Update the README**

Add a **Moderator commands** section documenting the four subcommands, that they require Manage Roles, and the difference between `unverify` (keeps history, blocks re-verification via a hold) and `reset` (wipes everything). Add a **Reminders** note: two DMs at ~24h and ~72h, then silence, and that the bot never kicks anyone.

- [ ] **Step 7: Commit**

```bash
git add src/discord src/index.ts README.md
git commit -m "feat: register moderator command and hourly reminder sweep"
```

## Acceptance Criteria

- A stalled member receives exactly two reminder DMs, at roughly 24h and 72h, then nothing further
- A member with closed DMs is not retried on every subsequent sweep
- Verified and held members are never sent reminders
- Reminder text lists only that member's outstanding steps and links that guild's channels
- Members in one guild are never affected by another guild's sweep
- A failure in one guild's sweep does not prevent the others from running
- No code path in the project kicks or bans a member
- `/onboarding` is invisible to members without Manage Roles
- `/onboarding unverify` survives a subsequent step event — the member stays unverified
- `/onboarding` against a member with no record behaves sensibly rather than silently doing nothing
- `pnpm test` and `pnpm typecheck` pass with the full suite green

## UI/UX Pattern

_N/A — no web UI surface._

## Open Questions

- [ ] None.

## Dependencies

- Requires: [[03-verification-gate]]
- Blocks: —

## Decisions

- 2026-08-10 — `reminders_sent` increments in every branch, including when the DM fails and when a member has nothing outstanding. Without this a row can be reselected by every sweep forever.
- 2026-08-10 — The sweep iterates guilds in a try/catch so one misconfigured server cannot stop reminders for every other server.
- 2026-08-10 — The sweep timer is `unref()`d so it never holds the process open during shutdown.
- 2026-08-10 — `/onboarding status` builds its reply in two branches rather than passing `content: undefined`, which `exactOptionalPropertyTypes` rejects.
