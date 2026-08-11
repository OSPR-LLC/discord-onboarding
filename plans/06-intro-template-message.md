---
plan: intro-template-message
project: discord-developer
updated: 2026-08-11
status: 🟡 In Progress
tags: [plan]
---

# 06 — Configurable introduction template message

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md`](../docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md) — this plan extends that design; it was not in the original spec.

## Status

🟡 In Progress

## Goal

> On `/config enable`, the bot posts (and pins, best-effort) a template message in the introductions channel — Name / Experience / Interests / Where are you from / Something about you by default — so members know what to post. Admins can customize the template text per-server via `/config intro-template`, exactly like `/config rules-text` already works for the rules message.

## Origin

Requested directly by the user, not derived from the original spec. The user asked for
new members to be "forced into #rules," moved to "#introductions... to post an
introduction from an introduction template message" before being verified. Three design
questions were resolved via `AskUserQuestion` before implementation:

1. **Keep the existing 3-question questionnaire?** → Yes, unchanged. This plan only adds
   the template message; it does not touch the rules → questionnaire → intro flow from
   Plan 03.
2. **Should the bot manage channel permissions to "force" members into `#rules`?** → No.
   The bot has never touched channel permission overwrites (only roles + messages) and
   this plan does not add that capability. Instead, the README documents the equivalent
   Discord-native channel-permission setup for admins to configure themselves.
3. **What does the template message look like, and is it configurable?** → Bot posts a
   pinned template on `/config enable`, with default fields Name / Experience / Interests
   / Where are you from / Something about you — but customizable per-guild via a new
   `/config intro-template` command, mirroring the existing `/config rules-text` pattern
   exactly (modal-editable text, default fallback, edit-in-place republish).

## Global Constraints

Inherits every constraint from [[01-bot-foundation]] through [[05-scale-hardening]].
Additionally:

- The bot never requests or uses channel `Manage Channels`/`Manage Permissions`
  permissions. Channel visibility gating is documented as an admin's own Discord server
  setup step, not bot-managed config.
- Pinning the template message needs `Manage Messages`, which is not otherwise required
  by this bot. A failed pin must not block `/config enable` or the message being posted —
  log and continue, matching how `sendDm` already treats closed DMs as non-fatal.
- This is the project's first schema change to an existing table. `CREATE TABLE IF NOT
  EXISTS` in `schema.sql` is a no-op against a database that already has the table, so
  new columns must also be added via a guarded `ALTER TABLE` in `migrate.ts` for
  currently-deployed databases.

## File Structure

| File                                              | Responsibility                                              |
| -------------------------------------------------- | ------------------------------------------------------------ |
| `src/db/schema.sql`                                | (modified) two new `guild_config` columns                    |
| `src/db/migrate.ts`                                | (modified) guarded `ALTER TABLE` for existing databases      |
| `src/db/guild-config-repository.ts`                | (modified) `setIntroTemplateText`, `setIntroTemplateMessageId` |
| `src/db/cached-guild-config-repository.ts`         | (modified) passthrough + invalidation for both new setters   |
| `src/core/guild-config.ts`                         | (modified) `DEFAULT_INTRO_TEMPLATE`, resolved fields          |
| `src/discord/components/custom-ids.ts`             | (modified) modal/input custom IDs                             |
| `src/discord/components/intro-template-message.ts` | (new) `buildIntroTemplateMessage`, `publishIntroTemplateMessage` |
| `src/discord/commands/config.ts`                   | (modified) `/config intro-template` subcommand + modal handler, wired into `enable` |
| `src/discord/preflight.ts`                         | (modified) introductions channel now needs Send Messages     |
| `src/index.ts`                                     | (modified) route the new modal submit                        |

---

### Task 1: Schema, migration, and repository layer

**Files:**

- Modify: `src/db/schema.sql`, `src/db/migrate.ts`, `src/db/guild-config-repository.ts`, `src/db/cached-guild-config-repository.ts`, `src/types.ts`
- Test: `tests/db/migrate.test.ts` (extended), `tests/db/cached-guild-config-repository.test.ts` (extended)

**Interfaces:**

- Adds `guild_config.intro_template_text` and `guild_config.intro_template_message_id`, both nullable `TEXT`.
- Produces: `GuildConfigRepository.setIntroTemplateText(guildId, text, actorId, at)`, `setIntroTemplateMessageId(guildId, messageId)` — same shape as the existing `setRulesText`/`setRulesMessageId` pair.

- [x] **Step 1: Add the two columns to `schema.sql`**
- [x] **Step 2: Add a guarded `ALTER TABLE` migration for existing databases**

`CREATE TABLE IF NOT EXISTS` never reaches a table that already exists, so a fresh
`schema.sql` column is invisible to any database created before this change. `migrate.ts`
now checks `PRAGMA table_info(guild_config)` and runs `ALTER TABLE ... ADD COLUMN` only
when the column is missing, once per database, ever.

- [x] **Step 3: Add repository methods and test coverage**

Mirrors `setRulesText`/`setRulesMessageId` exactly. Per existing project convention,
these are not unit-tested directly in `guild-config-repository.test.ts` (neither is the
rules-text pair) — coverage comes from the cached-repository invalidation matrix.

- [x] **Step 4: Verify**

Run: `pnpm test && pnpm typecheck`
Result: PASS. `migrate.test.ts` gained a test simulating a pre-existing database missing
the new columns (raw `CREATE TABLE` with the old shape, then `migrate()` against it) to
directly exercise the upgrade path, not just a fresh database.

- [x] **Step 5: Commit**

```bash
git add src/db/schema.sql src/db/migrate.ts src/db/guild-config-repository.ts src/db/cached-guild-config-repository.ts src/types.ts tests/db/migrate.test.ts tests/db/cached-guild-config-repository.test.ts
git commit -m "feat: add intro template columns and repository methods"
```

---

### Task 2: Default template, `ResolvedGuildConfig`, and the message component

**Files:**

- Modify: `src/core/guild-config.ts`
- Create: `src/discord/components/intro-template-message.ts`
- Test: `tests/core/guild-config.test.ts` (extended)

**Interfaces:**

- Produces: `DEFAULT_INTRO_TEMPLATE`, `ResolvedGuildConfig.introTemplateText: string`, `ResolvedGuildConfig.introTemplateMessageId: string | null`.
- Produces: `buildIntroTemplateMessage(config)`, `publishIntroTemplateMessage(guild, config, repo)` — mirrors `rules-message.ts`'s `buildRulesMessage`/`publishRulesMessage` pattern (edit-in-place if a stored message id still resolves, otherwise post fresh).

- [x] **Step 1: `DEFAULT_INTRO_TEMPLATE` and `ResolvedGuildConfig` fields**

Default text: Name / Experience / Interests / Where are you from / Something about you,
one bolded label per line. Falls back exactly like `DEFAULT_RULES_TEXT` does when the
guild has never customized it (`row.introTemplateText ?? DEFAULT_INTRO_TEMPLATE`).

- [x] **Step 2: `intro-template-message.ts`**

Same edit-vs-post-fresh logic as `rules-message.ts`, plus a best-effort `.pin()` after
the first post — caught and logged, never thrown, since `Manage Messages` isn't a hard
requirement of this bot.

- [x] **Step 3: Test the default-fallback resolution**

Added alongside the existing "falls back to the default rules text" test.

- [x] **Step 4: Verify**

Run: `pnpm test && pnpm typecheck`
Result: PASS. Every existing test file constructing a `ResolvedGuildConfig` object
literal (`reconcile.test.ts`, `reminder-sweep.test.ts`, `onboarding-service.test.ts`,
`onboarding-load.test.ts`) needed the two new required fields added — a mechanical,
not a logic, change.

- [x] **Step 5: Commit**

```bash
git add src/core/guild-config.ts src/discord/components/intro-template-message.ts tests/core/guild-config.test.ts tests/tasks/reconcile.test.ts tests/tasks/reminder-sweep.test.ts tests/core/onboarding-service.test.ts tests/load/onboarding-load.test.ts
git commit -m "feat: add intro template default, resolution, and message component"
```

---

### Task 3: `/config intro-template` command and wiring

**Files:**

- Modify: `src/discord/components/custom-ids.ts`, `src/discord/commands/config.ts`, `src/discord/preflight.ts`, `src/index.ts`, `README.md`

**Interfaces:**

- Adds `CUSTOM_IDS.introTemplateModal`, `CUSTOM_IDS.introTemplateInput`.
- Produces: `handleIntroTemplateModal(interaction, deps)` — mirrors `handleRulesTextModal`.
- `enable` now also calls `publishIntroTemplateMessage` alongside `publishRulesMessage` and reports both outcomes in its reply.

- [x] **Step 1: Custom IDs**
- [x] **Step 2: `/config intro-template` subcommand + modal-opening branch**

Mirrors `/config rules-text` exactly: pre-fills the modal with the current (or default)
text, 4000-char limit matching Discord's modal input ceiling.

- [x] **Step 3: `handleIntroTemplateModal`**

Saves the text, and — if a template message is already posted (i.e. onboarding has been
enabled before) — republishes it in place immediately, matching `handleRulesTextModal`'s
behavior for the rules message.

- [x] **Step 4: Wire into `enable` and route the modal in `index.ts`**
- [x] **Step 5: Preflight — introductions channel now needs Send Messages**

Previously `needsSend: false` for the introductions channel (the bot only ever read
messages there). Publishing the template message on `enable` means it now genuinely
needs to send there too.

- [x] **Step 6: README**

Updated: permission integer (`268520448` → `268528640`, adding Manage Messages 8192),
the `/config` command list, `enable`'s behavior description, and a new "Restricting
channels for new members" section documenting the Discord-native channel-permission
setup that achieves "force members into #rules" — since the bot itself doesn't manage
channel permissions. Also fixed a stale Status line still describing Plan 03 as "next"
when all 5 plans are actually code-complete.

- [x] **Step 7: Verify the full suite**

Run: `pnpm test && pnpm typecheck`
Result: PASS — 146 tests, 17 files, no type errors.

- [ ] **Step 8: Verify against a live guild**

Run `/config intro-template`, customize the text, run `/config enable`, confirm the
template posts and pins in the introductions channel (or logs a skipped-pin line if the
bot lacks Manage Messages), and that re-running `/config intro-template` after enabling
edits the posted message in place rather than duplicating it. _(requires a live Discord
client — yours to run, same as every other hands-on item in this project.)_

- [x] **Step 9: Commit**

```bash
git add src/discord/components/custom-ids.ts src/discord/commands/config.ts src/discord/preflight.ts src/index.ts README.md
git commit -m "feat: add /config intro-template command and wire it into enable"
```

## Acceptance Criteria

- `/config intro-template` opens a modal pre-filled with the current (or default) template text
- `/config enable` posts the template message in the introductions channel, pinning it best-effort
- Re-running `/config enable` or `/config intro-template` after the message exists edits it in place, never duplicates it
- A guild that never customizes the template gets the default text (Name/Experience/Interests/Where are you from/Something about you)
- A missing `Manage Messages` permission never blocks `/config enable` or the message being posted — only the pin is skipped
- A pre-existing database (created before this plan) picks up the new columns automatically on next startup, with no data loss
- The questionnaire flow from [[03-verification-gate]] is untouched
- `pnpm test` and `pnpm typecheck` pass

## UI/UX Pattern

_N/A — no web UI surface. Admin interaction is a native Discord modal, matching `/config rules-text`._

## Open Questions

- [ ] None.

## Dependencies

- Requires: [[02-guild-configuration]] (extends `/config` and the guild config repository)
- Blocks: —

## Decisions

- 2026-08-11 — The bot will never manage Discord channel permission overwrites. "Forcing" members into `#rules` is documented as an admin's own server-configuration step (README: "Restricting channels for new members"), not a bot capability — keeps the bot's permission footprint minimal and avoids a `Manage Channels`/`Manage Permissions` requirement that would apply to every server, not just ones that want this.
- 2026-08-11 — Pinning the template message is best-effort. `Manage Messages` is not added to the bot's required permission set; a failed pin is logged and swallowed, matching how DM failures are already treated as expected, non-fatal outcomes elsewhere in the codebase.
- 2026-08-11 — The introduction template is configured exactly like the rules text (`/config intro-template`, modal-editable, per-guild default fallback, edit-in-place republish) rather than inventing a new configuration pattern — one less shape for an admin or a future maintainer to learn.
- 2026-08-11 — This is the project's first schema change to an already-shipped table. Established the pattern going forward: new nullable columns go in `schema.sql` for fresh databases *and* in a guarded `ALTER TABLE` list in `migrate.ts` for existing ones — `CREATE TABLE IF NOT EXISTS` alone never reaches a database that predates the column.
