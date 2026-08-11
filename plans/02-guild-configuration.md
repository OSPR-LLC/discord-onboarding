---
plan: guild-configuration
project: discord-developer
updated: 2026-08-10
status: 🟡 In Progress
tags: [plan]
---

# 02 — Guild configuration & `/config` commands

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md`](../docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md)

## Status

🟡 In Progress

## Goal

> A server admin can invite the bot and configure it entirely from inside Discord: point it at three channels and two roles, set the rules text, then switch it on. Enabling runs a live preflight that refuses on misconfiguration, stamps a grandfather cutoff so existing members are never disturbed, and publishes the rules message. Still no gate behaviour — that is plan 03.

## Global Constraints

Inherits every constraint from [[01-bot-foundation]]. Additionally:

- `src/core/` must never import `discord.js`.
- **A disabled or unconfigured guild is completely inert.** Any handler must resolve config and return early before taking any action.
- `/config` requires **Manage Server**; commands register globally.
- Enabling a guild must never restrict a member who joined before it was enabled.

## File Structure

| File                                      | Responsibility                                                        |
| ----------------------------------------- | --------------------------------------------------------------------- |
| `src/core/guild-config.ts`                | `resolveGuildConfig` — narrows a partial row or names what is missing |
| `src/discord/preflight.ts`                | Live Discord validation (roles, channels, permissions)                |
| `src/discord/commands/config.ts`          | The `/config` command and its subcommands                             |
| `src/discord/components/rules-message.ts` | Rules embed + agree button, publish/update                            |
| `src/discord/components/custom-ids.ts`    | Build and parse component ids                                         |
| `src/discord/register-commands.ts`        | Global (and optional dev-guild) command registration                  |
| `README.md`                               | Setup docs, now that the `/config` flow exists                        |

---

### Task 1: Config resolution

**Files:**

- Create: `src/core/guild-config.ts`
- Test: `tests/core/guild-config.test.ts`

**Interfaces:**

- Consumes: `GuildConfigRow`, `Result` from `src/types.ts`.
- Produces: `ResolvedGuildConfig`, `ConfigProblem`, `resolveGuildConfig(row): Result<ResolvedGuildConfig, ConfigProblem[]>`, and `DEFAULT_RULES_TEXT`. Plans 03 and 04 accept only `ResolvedGuildConfig`.

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { resolveGuildConfig } from '../../src/core/guild-config.js'
import { isOk } from '../../src/types.js'
import type { GuildConfigRow } from '../../src/types.js'

const complete: GuildConfigRow = {
	guildId: '1',
	rulesChannelId: '2',
	introductionsChannelId: '3',
	modLogChannelId: '4',
	verifiedRoleId: '5',
	unverifiedRoleId: '6',
	rulesText: 'Be nice.',
	rulesMessageId: null,
	enabled: true,
	grandfatherBefore: '2026-08-10T00:00:00.000Z',
	joinedAt: '2026-08-01T00:00:00.000Z',
	configuredAt: null,
	configuredBy: null
}

describe('resolveGuildConfig', () => {
	it('resolves a complete row', () => {
		const result = resolveGuildConfig(complete)
		expect(isOk(result)).toBe(true)
		if (isOk(result)) expect(result.value.rulesChannelId).toBe('2')
	})

	it('reports a null guild as entirely unconfigured', () => {
		const result = resolveGuildConfig(null)
		expect(isOk(result)).toBe(false)
		if (!isOk(result)) expect(result.error.length).toBeGreaterThan(0)
	})

	// Typed as a tuple of literal keys rather than plain strings: a computed
	// key of type `string` in the spread below would widen the object and fail
	// to typecheck against GuildConfigRow.
	const requiredFields = [
		'rulesChannelId',
		'introductionsChannelId',
		'modLogChannelId',
		'verifiedRoleId',
		'unverifiedRoleId'
	] as const satisfies readonly (keyof GuildConfigRow)[]

	it.each(requiredFields)('names %s when it is missing', (field) => {
		const result = resolveGuildConfig({ ...complete, [field]: null })
		expect(isOk(result)).toBe(false)
		if (!isOk(result)) expect(result.error.map((problem) => problem.field)).toContain(field)
	})

	it('reports every missing field at once rather than only the first', () => {
		const result = resolveGuildConfig({
			...complete,
			rulesChannelId: null,
			verifiedRoleId: null
		})
		if (!isOk(result)) expect(result.error).toHaveLength(2)
	})

	it('falls back to the default rules text when none has been set', () => {
		const result = resolveGuildConfig({ ...complete, rulesText: null })
		expect(isOk(result)).toBe(true)
		if (isOk(result)) expect(result.value.rulesText.length).toBeGreaterThan(0)
	})
})
```

- [x] **Step 2: Run it to confirm it fails**

Run: `pnpm test tests/core/guild-config.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Write `src/core/guild-config.ts`**

```ts
import { err, ok, type GuildConfigRow, type Result } from '../types.js'

export const DEFAULT_RULES_TEXT = [
	'Be respectful. No harassment, hate speech, or personal attacks.',
	'No spam, unsolicited advertising, or mass DMs.',
	'Keep discussion in the channel it belongs in.',
	'No piracy, malware, or requests for either.',
	'Moderator decisions are final — raise disputes privately, not in public.'
]
	.map((rule, index) => `**${index + 1}.** ${rule}`)
	.join('\n\n')

export type ResolvedGuildConfig = {
	readonly guildId: string
	readonly rulesChannelId: string
	readonly introductionsChannelId: string
	readonly modLogChannelId: string
	readonly verifiedRoleId: string
	readonly unverifiedRoleId: string
	readonly rulesText: string
	readonly rulesMessageId: string | null
	readonly grandfatherBefore: string | null
}

export type ConfigProblem = { readonly field: string; readonly message: string }

const REQUIRED: { field: keyof GuildConfigRow; label: string; command: string }[] = [
	{ field: 'rulesChannelId', label: 'rules channel', command: '/config channel rules' },
	{
		field: 'introductionsChannelId',
		label: 'introductions channel',
		command: '/config channel introductions'
	},
	{ field: 'modLogChannelId', label: 'mod log channel', command: '/config channel modlog' },
	{ field: 'verifiedRoleId', label: 'verified role', command: '/config role verified' },
	{ field: 'unverifiedRoleId', label: 'unverified role', command: '/config role unverified' }
]

export const resolveGuildConfig = (
	row: GuildConfigRow | null
): Result<ResolvedGuildConfig, ConfigProblem[]> => {
	if (!row)
		return err(
			REQUIRED.map(({ field, label, command }) => ({
				field,
				message: `No ${label} set. Use \`${command}\`.`
			}))
		)

	const problems = REQUIRED.filter(({ field }) => !row[field]).map(({ field, label, command }) => ({
		field,
		message: `No ${label} set. Use \`${command}\`.`
	}))

	if (problems.length > 0) return err(problems)

	return ok({
		guildId: row.guildId,
		rulesChannelId: row.rulesChannelId as string,
		introductionsChannelId: row.introductionsChannelId as string,
		modLogChannelId: row.modLogChannelId as string,
		verifiedRoleId: row.verifiedRoleId as string,
		unverifiedRoleId: row.unverifiedRoleId as string,
		rulesText: row.rulesText ?? DEFAULT_RULES_TEXT,
		rulesMessageId: row.rulesMessageId,
		grandfatherBefore: row.grandfatherBefore
	})
}
```

- [x] **Step 4: Run the test to confirm it passes**

Run: `pnpm test tests/core/guild-config.test.ts`
Expected: PASS, 9 tests.

- [x] **Step 5: Commit**

```bash
git add src/core/guild-config.ts tests/core/guild-config.test.ts
git commit -m "feat: add guild config resolution"
```

---

### Task 2: Live preflight

**Files:**

- Create: `src/discord/preflight.ts`

**Interfaces:**

- Consumes: `ResolvedGuildConfig`, `ConfigProblem`.
- Produces: `runPreflight(guild, config): Promise<ConfigProblem[]>` — empty means healthy. Task 4's `/config enable` refuses when this returns anything.

- [x] **Step 1: Write `src/discord/preflight.ts`**

```ts
import { PermissionFlagsBits, type Guild } from 'discord.js'
import type { ConfigProblem, ResolvedGuildConfig } from '../core/guild-config.js'

export const runPreflight = async (
	guild: Guild,
	config: ResolvedGuildConfig
): Promise<ConfigProblem[]> => {
	const problems: ConfigProblem[] = []
	const me = await guild.members.fetchMe()

	if (!me.permissions.has(PermissionFlagsBits.ManageRoles))
		problems.push({
			field: 'permissions',
			message: 'I need the **Manage Roles** permission in this server.'
		})

	for (const [field, label, roleId] of [
		['verifiedRoleId', 'verified', config.verifiedRoleId],
		['unverifiedRoleId', 'unverified', config.unverifiedRoleId]
	] as const) {
		const role = await guild.roles.fetch(roleId).catch(() => null)

		if (!role) {
			problems.push({ field, message: `The ${label} role no longer exists. Set it again.` })
			continue
		}

		if (role.managed)
			problems.push({
				field,
				message: `The ${label} role is managed by an integration and cannot be assigned by me.`
			})
		else if (role.comparePositionTo(me.roles.highest) >= 0)
			problems.push({
				field,
				message: `The ${label} role (**${role.name}**) sits at or above my highest role, so I cannot assign it. Drag my role above it in Server Settings → Roles.`
			})
	}

	if (config.verifiedRoleId === config.unverifiedRoleId)
		problems.push({
			field: 'roles',
			message: 'The verified and unverified roles must be different roles.'
		})

	for (const [field, label, channelId, needsSend] of [
		['rulesChannelId', 'rules', config.rulesChannelId, true],
		['introductionsChannelId', 'introductions', config.introductionsChannelId, false],
		['modLogChannelId', 'mod log', config.modLogChannelId, true]
	] as const) {
		const channel = await guild.channels.fetch(channelId).catch(() => null)

		if (!channel?.isTextBased()) {
			problems.push({ field, message: `The ${label} channel is missing or is not a text channel.` })
			continue
		}

		const permissions = channel.permissionsFor(me)

		if (!permissions?.has(PermissionFlagsBits.ViewChannel))
			problems.push({ field, message: `I cannot see the ${label} channel.` })
		else if (needsSend && !permissions.has(PermissionFlagsBits.SendMessages))
			problems.push({ field, message: `I cannot send messages in the ${label} channel.` })
	}

	return problems
}
```

- [x] **Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: no errors.

- [x] **Step 3: Commit**

```bash
git add src/discord/preflight.ts
git commit -m "feat: add live guild preflight validation"
```

---

### Task 3: Custom ids and the rules message

**Files:**

- Create: `src/discord/components/custom-ids.ts`, `src/discord/components/rules-message.ts`
- Test: `tests/discord/custom-ids.test.ts`

**Interfaces:**

- Produces: `CUSTOM_IDS`, `parseCustomId(raw)`, `buildRulesMessage(config)`, and
  `publishRulesMessage(guild, config, repo): Promise<Result<string, string>>` returning the message id.
  Plan 03's interaction router consumes `CUSTOM_IDS` and `parseCustomId`.

- [x] **Step 1: Write the failing test**

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

	it('parses a yes/no answer with its value', () => {
		expect(parseCustomId('onboarding:q3:yes')).toEqual({
			namespace: 'onboarding',
			action: 'q3',
			value: 'yes'
		})
	})

	it('returns null for an id belonging to another bot', () => {
		expect(parseCustomId('other-bot:thing')).toBeNull()
	})

	it('returns null for a malformed id', () => {
		expect(parseCustomId('onboarding')).toBeNull()
	})
})
```

- [x] **Step 2: Run it to confirm it fails**

Run: `pnpm test tests/discord/custom-ids.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Write `src/discord/components/custom-ids.ts`**

```ts
const NAMESPACE = 'onboarding'

export const CUSTOM_IDS = {
	rulesAgree: `${NAMESPACE}:rules-agree`,
	purposeModal: `${NAMESPACE}:q1-modal`,
	purposeInput: `${NAMESPACE}:q1-input`,
	experienceSelect: `${NAMESPACE}:q2`,
	builtYes: `${NAMESPACE}:q3:yes`,
	builtNo: `${NAMESPACE}:q3:no`,
	rulesTextModal: `${NAMESPACE}:rules-text-modal`,
	rulesTextInput: `${NAMESPACE}:rules-text-input`
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

- [x] **Step 4: Write `src/discord/components/rules-message.ts`**

The message id is stored, so republishing edits that exact message. Scanning channel history would break as soon as the channel got busy.

_Typed the built payload as a narrow local type rather than discord.js's `MessageCreateOptions`: that type's `flags` field accepts values (e.g. `IsVoiceMessage`) that `MessageEditOptions` rejects, so `existing.edit(payload)` fails to typecheck under `exactOptionalPropertyTypes` even though `flags` is never set here. Since this payload only ever carries `embeds` and `components` — which both `send()` and `edit()` accept identically — a local `RulesMessagePayload` type sidesteps the mismatch entirely. Applied below._

```ts
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Guild } from 'discord.js'
import type { ResolvedGuildConfig } from '../../core/guild-config.js'
import type { GuildConfigRepository } from '../../db/guild-config-repository.js'
import { err, ok, type Result } from '../../types.js'
import { CUSTOM_IDS } from './custom-ids.js'

type RulesMessagePayload = {
	readonly embeds: EmbedBuilder[]
	readonly components: ActionRowBuilder<ButtonBuilder>[]
}

export const buildRulesMessage = (config: ResolvedGuildConfig): RulesMessagePayload => ({
	embeds: [
		new EmbedBuilder()
			.setTitle('Server rules')
			.setDescription(config.rulesText)
			.setFooter({ text: 'Agreeing is the first of three steps to get access.' })
	],
	components: [
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(CUSTOM_IDS.rulesAgree)
				.setLabel('I agree')
				.setStyle(ButtonStyle.Success)
		)
	]
})

export const publishRulesMessage = async (
	guild: Guild,
	config: ResolvedGuildConfig,
	repo: GuildConfigRepository
): Promise<Result<string, string>> => {
	const channel = await guild.channels.fetch(config.rulesChannelId).catch(() => null)
	if (!channel?.isTextBased()) return err('The rules channel is missing or is not a text channel.')

	const payload = buildRulesMessage(config)

	if (config.rulesMessageId) {
		const existing = await channel.messages.fetch(config.rulesMessageId).catch(() => null)
		if (existing) {
			await existing.edit(payload)
			return ok(existing.id)
		}
		// Stored id no longer resolves — the message was deleted or the channel changed.
	}

	const posted = await channel.send(payload)
	repo.setRulesMessageId(guild.id, posted.id)
	return ok(posted.id)
}
```

- [x] **Step 5: Run the test to confirm it passes**

Run: `pnpm test tests/discord/custom-ids.test.ts`
Expected: PASS, 4 tests.

- [x] **Step 6: Commit**

```bash
git add src/discord/components tests/discord
git commit -m "feat: add custom ids and publishable rules message"
```

---

### Task 4: The `/config` command

**Files:**

- Create: `src/discord/commands/config.ts`

**Interfaces:**

- Consumes: `GuildConfigRepository`, `resolveGuildConfig`, `runPreflight`, `publishRulesMessage`, `CUSTOM_IDS`.
- Produces: `configCommand` (the builder) and `handleConfigCommand(interaction, deps)` plus
  `handleRulesTextModal(interaction, deps)`, where `deps` is `{ guildConfig, now }`.

- [x] **Step 1: Write `src/discord/commands/config.ts`**

```ts
import {
	ChannelType,
	EmbedBuilder,
	MessageFlags,
	ModalBuilder,
	PermissionFlagsBits,
	SlashCommandBuilder,
	TextInputBuilder,
	TextInputStyle,
	ActionRowBuilder,
	type ChatInputCommandInteraction,
	type ModalSubmitInteraction
} from 'discord.js'
import { DEFAULT_RULES_TEXT, resolveGuildConfig } from '../../core/guild-config.js'
import type { GuildConfigRepository } from '../../db/guild-config-repository.js'
import { isOk } from '../../types.js'
import { CUSTOM_IDS } from '../components/custom-ids.js'
import { publishRulesMessage } from '../components/rules-message.js'
import { runPreflight } from '../preflight.js'

export const configCommand = new SlashCommandBuilder()
	.setName('config')
	.setDescription('Configure member onboarding for this server')
	.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
	.setDMPermission(false)
	.addSubcommand((sub) => sub.setName('show').setDescription('Show the current configuration'))
	.addSubcommand((sub) =>
		sub
			.setName('channel')
			.setDescription('Set one of the onboarding channels')
			.addStringOption((option) =>
				option
					.setName('which')
					.setDescription('Which channel to set')
					.setRequired(true)
					.addChoices(
						{ name: 'rules', value: 'rules' },
						{ name: 'introductions', value: 'introductions' },
						{ name: 'mod log', value: 'modlog' }
					)
			)
			.addChannelOption((option) =>
				option
					.setName('channel')
					.setDescription('The channel')
					.addChannelTypes(ChannelType.GuildText)
					.setRequired(true)
			)
	)
	.addSubcommand((sub) =>
		sub
			.setName('role')
			.setDescription('Set one of the onboarding roles')
			.addStringOption((option) =>
				option
					.setName('which')
					.setDescription('Which role to set')
					.setRequired(true)
					.addChoices(
						{ name: 'verified', value: 'verified' },
						{ name: 'unverified', value: 'unverified' }
					)
			)
			.addRoleOption((option) =>
				option.setName('role').setDescription('The role').setRequired(true)
			)
	)
	.addSubcommand((sub) => sub.setName('rules-text').setDescription('Edit the rules text'))
	.addSubcommand((sub) => sub.setName('enable').setDescription('Turn onboarding on'))
	.addSubcommand((sub) => sub.setName('disable').setDescription('Turn onboarding off'))
	.addSubcommand((sub) =>
		sub
			.setName('grandfather')
			.setDescription('Manage the cutoff that exempts existing members')
			.addStringOption((option) =>
				option
					.setName('action')
					.setDescription('What to do')
					.setRequired(true)
					.addChoices({ name: 'clear (gate existing members too)', value: 'clear' })
			)
	)

export type ConfigCommandDeps = {
	readonly guildConfig: GuildConfigRepository
	readonly now: () => string
}

const ephemeral = { flags: MessageFlags.Ephemeral } as const

export const handleConfigCommand = async (
	interaction: ChatInputCommandInteraction,
	deps: ConfigCommandDeps
): Promise<void> => {
	const { guild } = interaction
	if (!guild) return

	const { guildConfig, now } = deps
	const actorId = interaction.user.id
	const subcommand = interaction.options.getSubcommand()

	guildConfig.ensure(guild.id, now())

	if (subcommand === 'show') {
		const row = guildConfig.get(guild.id)
		const resolved = resolveGuildConfig(row)

		const embed = new EmbedBuilder().setTitle('Onboarding configuration').addFields(
			{ name: 'Status', value: row?.enabled ? '🟢 Enabled' : '🔴 Disabled', inline: false },
			{
				name: 'Rules channel',
				value: row?.rulesChannelId ? `<#${row.rulesChannelId}>` : '— not set',
				inline: true
			},
			{
				name: 'Introductions channel',
				value: row?.introductionsChannelId ? `<#${row.introductionsChannelId}>` : '— not set',
				inline: true
			},
			{
				name: 'Mod log channel',
				value: row?.modLogChannelId ? `<#${row.modLogChannelId}>` : '— not set',
				inline: true
			},
			{
				name: 'Verified role',
				value: row?.verifiedRoleId ? `<@&${row.verifiedRoleId}>` : '— not set',
				inline: true
			},
			{
				name: 'Unverified role',
				value: row?.unverifiedRoleId ? `<@&${row.unverifiedRoleId}>` : '— not set',
				inline: true
			},
			{
				name: 'Existing members exempt',
				value: row?.grandfatherBefore
					? `Yes — everyone who joined before <t:${Math.floor(Date.parse(row.grandfatherBefore) / 1000)}:f>`
					: 'No — every member is subject to the gate',
				inline: false
			}
		)

		if (!isOk(resolved))
			embed.addFields({
				name: '⚠️ Still needed',
				value: resolved.error.map((problem) => `• ${problem.message}`).join('\n')
			})

		await interaction.reply({ embeds: [embed], ...ephemeral })
		return
	}

	if (subcommand === 'channel') {
		const which = interaction.options.getString('which', true) as
			'rules' | 'introductions' | 'modlog'
		const channel = interaction.options.getChannel('channel', true)

		guildConfig.setChannel(guild.id, which, channel.id, actorId, now())
		await interaction.reply({
			content: `Set the **${which}** channel to <#${channel.id}>.`,
			...ephemeral
		})
		return
	}

	if (subcommand === 'role') {
		const which = interaction.options.getString('which', true) as 'verified' | 'unverified'
		const role = interaction.options.getRole('role', true)

		guildConfig.setRole(guild.id, which, role.id, actorId, now())
		await interaction.reply({
			content: `Set the **${which}** role to <@&${role.id}>.`,
			...ephemeral
		})
		return
	}

	if (subcommand === 'rules-text') {
		const current = guildConfig.get(guild.id)?.rulesText ?? DEFAULT_RULES_TEXT

		await interaction.showModal(
			new ModalBuilder()
				.setCustomId(CUSTOM_IDS.rulesTextModal)
				.setTitle('Server rules')
				.addComponents(
					new ActionRowBuilder<TextInputBuilder>().addComponents(
						new TextInputBuilder()
							.setCustomId(CUSTOM_IDS.rulesTextInput)
							.setLabel('Rules shown to new members')
							.setStyle(TextInputStyle.Paragraph)
							.setMaxLength(4000)
							.setRequired(true)
							.setValue(current.slice(0, 4000))
					)
				)
		)
		return
	}

	if (subcommand === 'enable') {
		await interaction.deferReply(ephemeral)

		const resolved = resolveGuildConfig(guildConfig.get(guild.id))
		if (!isOk(resolved)) {
			await interaction.editReply({
				content: `I cannot enable onboarding yet:\n${resolved.error
					.map((problem) => `• ${problem.message}`)
					.join('\n')}`
			})
			return
		}

		const problems = await runPreflight(guild, resolved.value)
		if (problems.length > 0) {
			await interaction.editReply({
				content: `I cannot enable onboarding yet:\n${problems
					.map((problem) => `• ${problem.message}`)
					.join('\n')}`
			})
			return
		}

		const at = now()
		guildConfig.enable(guild.id, at, actorId, at)

		const published = await publishRulesMessage(guild, { ...resolved.value }, guildConfig)
		const members = await guild.members.fetch()
		const grandfathered = members.filter(
			(member) => !member.user.bot && (member.joinedTimestamp ?? 0) < Date.parse(at)
		).size

		await interaction.editReply({
			content: [
				'✅ Onboarding is **on**.',
				'',
				`**${grandfathered}** existing member${grandfathered === 1 ? '' : 's'} ${grandfathered === 1 ? 'was' : 'were'} exempted — nobody already here is affected. Only members who join from now on go through the gate.`,
				'',
				isOk(published)
					? `The rules message is posted in <#${resolved.value.rulesChannelId}>.`
					: `⚠️ I could not post the rules message: ${published.error}`,
				'',
				'To also require existing members to onboard, run `/config grandfather action:clear`.'
			].join('\n')
		})
		return
	}

	if (subcommand === 'disable') {
		guildConfig.disable(guild.id)
		await interaction.reply({
			content:
				'Onboarding is **off**. I will take no further action in this server. Your configuration and all member records are kept.',
			...ephemeral
		})
		return
	}

	if (subcommand === 'grandfather') {
		await interaction.deferReply(ephemeral)

		const row = guildConfig.get(guild.id)
		if (!row?.grandfatherBefore) {
			await interaction.editReply({
				content: 'No exemption is set — every member is already subject to the gate.'
			})
			return
		}

		const members = await guild.members.fetch()
		const affected = members.filter(
			(member) =>
				!member.user.bot &&
				(member.joinedTimestamp ?? 0) < Date.parse(row.grandfatherBefore as string)
		).size

		guildConfig.clearGrandfather(guild.id)

		await interaction.editReply({
			content: `Exemption cleared. **${affected}** existing member${affected === 1 ? '' : 's'} will now be asked to complete onboarding, and will receive the unverified role on the next restart or when they next trigger the bot.`
		})
	}
}

export const handleRulesTextModal = async (
	interaction: ModalSubmitInteraction,
	deps: ConfigCommandDeps
): Promise<void> => {
	if (!interaction.guild) return

	const text = interaction.fields.getTextInputValue(CUSTOM_IDS.rulesTextInput)
	deps.guildConfig.setRulesText(interaction.guild.id, text, interaction.user.id, deps.now())

	const resolved = resolveGuildConfig(deps.guildConfig.get(interaction.guild.id))
	const republished =
		isOk(resolved) && resolved.value.rulesMessageId
			? await publishRulesMessage(interaction.guild, resolved.value, deps.guildConfig)
			: null

	await interaction.reply({
		content: republished
			? 'Rules updated and the posted rules message has been refreshed.'
			: 'Rules updated. They will be posted when you run `/config enable`.',
		...ephemeral
	})
}
```

- [x] **Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: no errors.

- [x] **Step 3: Commit**

```bash
git add src/discord/commands/config.ts
git commit -m "feat: add /config command"
```

---

### Task 5: Command registration and wiring

**Files:**

- Create: `src/discord/register-commands.ts`
- Modify: `src/index.ts`

**Interfaces:**

- Produces: `registerCommands(client, devGuildId?): Promise<void>`. Plans 03 and 04 add their commands to the single array inside it.

- [ ] **Step 1: Write `src/discord/register-commands.ts`**

```ts
import type { Client } from 'discord.js'
import { configCommand } from './commands/config.js'

export const registerCommands = async (
	client: Client<true>,
	devGuildId?: string
): Promise<void> => {
	const commands = [configCommand.toJSON()]

	await client.application.commands.set(commands)

	// Global commands can take up to an hour to propagate. A dev guild gets
	// them immediately, which keeps iteration tolerable.
	if (devGuildId) {
		const guild = await client.guilds.fetch(devGuildId).catch(() => null)
		if (guild) await guild.commands.set(commands)
	}

	console.info(
		JSON.stringify({ level: 'info', event: 'commands-registered', count: commands.length })
	)
}
```

- [ ] **Step 2: Wire into `src/index.ts`**

Inside the existing `ClientReady` handler, after the guild-config loop:

```ts
await registerCommands(ready, env.devGuildId)
```

And add an interaction listener after the `GuildCreate` listener:

```ts
client.on(
	Events.InteractionCreate,
	safeHandler('interactionCreate', async (interaction) => {
		const deps = { guildConfig, now: () => new Date().toISOString() }

		if (interaction.isChatInputCommand() && interaction.commandName === 'config') {
			await handleConfigCommand(interaction, deps)
			return
		}

		if (interaction.isModalSubmit() && interaction.customId === CUSTOM_IDS.rulesTextModal) {
			await handleRulesTextModal(interaction, deps)
		}
	})
)
```

Add the matching imports.

- [ ] **Step 3: Also ensure a config row exists when a guild is left and rejoined**

Add a `GuildDelete` listener that logs but **does not delete data** — a bot removed and re-added should not lose its configuration:

```ts
client.on(
	Events.GuildDelete,
	safeHandler('guildDelete', async (guild) => {
		console.info(JSON.stringify({ level: 'info', event: 'guild-left', guildId: guild.id }))
	})
)
```

- [ ] **Step 4: Verify the whole flow by hand**

Against a throwaway guild:

1. `/config show` → everything "not set", status Disabled, a list of what is needed
2. `/config enable` → refuses, naming all five missing settings
3. Set all three channels and both roles
4. Deliberately drag the bot's role _below_ `verified`, then `/config enable` → refuses naming the hierarchy problem
5. Fix the hierarchy, `/config enable` → succeeds, reports the grandfathered count, rules message appears in the rules channel
6. `/config rules-text` → modal opens pre-filled; submitting edits the posted message in place
7. `/config disable` then `/config show` → status Disabled, settings retained

- [ ] **Step 5: Commit**

```bash
git add src/discord/register-commands.ts src/index.ts
git commit -m "feat: register commands and wire /config"
```

---

### Task 6: README

**Files:**

- Create: `README.md`

- [ ] **Step 1: Write the README**

Cover, in this order:

1. **What it is** — the three-step gate, and that any server can add it.
2. **Prerequisites** — Node 20+, pnpm.
3. **Create the Discord application** — Developer Portal → New Application → Bot → Reset Token.
4. **Enable the Server Members intent** — Bot → Privileged Gateway Intents → **Server Members Intent** ON. Say plainly that without it the bot never receives join events and onboarding silently does nothing. Note Message Content is deliberately **not** required.
5. **Invite the bot** — OAuth2 URL Generator, scopes `bot` and `applications.commands`, permissions Manage Roles, Send Messages, Read Message History, Embed Links.
6. **Role hierarchy** — drag the bot's role above both onboarding roles. Flag this as the most common cause of silent role-assignment failure.
7. **Environment** — only `DISCORD_TOKEN` and `DATABASE_PATH`, plus optional `DEV_GUILD_ID`. State explicitly that all server settings are configured in Discord, not here.
8. **Configure a server** — the `/config` walkthrough: `show`, `channel`, `role`, `rules-text`, `enable`.
9. **What enabling does** — turns the gate on for _future_ joins only, exempting everyone already present, and how `/config grandfather action:clear` changes that.
10. **Run** — `pnpm i`, `pnpm dev`, `pnpm test`, `pnpm build && pnpm start`.
11. **Troubleshooting** — table: no join events → Server Members intent; roles not applied → hierarchy; commands missing → wait for global propagation or set `DEV_GUILD_ID`; nothing happening at all → guild not enabled.

- [ ] **Step 2: Verify the README end to end**

Follow it literally against a fresh throwaway guild. Any step requiring knowledge not written down is a bug in the README.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add setup and per-server configuration guide"
```

## Acceptance Criteria

- `/config show` works on a guild that has never been configured and lists every missing setting
- `/config enable` refuses while anything is missing, naming **all** missing fields at once
- `/config enable` refuses when the bot's role sits below either onboarding role, naming the role
- `/config enable` refuses when verified and unverified are the same role
- A successful `/config enable` reports the number of grandfathered members and posts the rules message
- `/config rules-text` opens pre-filled and editing republishes the existing message rather than posting a duplicate
- `/config disable` stops all activity but retains configuration and records
- The bot performs **no** role changes anywhere in this plan
- `pnpm test` and `pnpm typecheck` pass

## UI/UX Pattern

_N/A — no web UI. Admin interaction is native Discord slash commands, embeds, and one modal._

## Open Questions

- [ ] None.

## Dependencies

- Requires: [[01-bot-foundation]]
- Blocks: [[03-verification-gate]]

## Decisions

- 2026-08-10 — `resolveGuildConfig` reports **every** missing field at once rather than the first, so an admin fixes configuration in one pass instead of one command per restart.
- 2026-08-10 — Preflight runs inside `/config enable` rather than at startup, so failures reach the admin who can act on them instead of a console they cannot see.
- 2026-08-10 — Enabling stamps `grandfather_before` and reports the exempted count, making it obvious that switching on does not disturb the existing community.
- 2026-08-10 — The rules message id is stored rather than discovered by scanning channel history, which would break in a busy channel.
- 2026-08-10 — `guildDelete` deliberately does not delete configuration; a bot briefly removed and re-added should not lose its setup.
