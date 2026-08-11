# PLAN — discord-developer

> Master plan. Links to sub-plans in `plans/`. Source of truth for project state.

## Status

🟡 In Progress

## Goal

> A Discord onboarding bot **any server can add**. Admins configure it entirely with `/config` slash commands — no config files, no restart. Once enabled, members who join must accept the rules, complete a three-question intro questionnaire, and post in the introductions channel before the bot automatically grants a `verified` role. Members who were already in the server when it was enabled are never affected.

## Spec

[`docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md`](docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md) — authoritative design (revised 2026-08-10 for multi-guild). Plans below derive from it.

## Phases & Sub-Plans

| #   | Plan                                                                        | Status         | Notes                                                               |
| --- | --------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------- |
| 01  | [plans/01-bot-foundation](plans/01-bot-foundation.md)                       | ✅ Complete    | Scaffold, multi-guild schema, both repositories, client bootstrap   |
| 02  | [plans/02-guild-configuration](plans/02-guild-configuration.md)             | 🟡 In Progress | `/config` commands, preflight, enable gate + grandfathering, README |
| 03  | [plans/03-verification-gate](plans/03-verification-gate.md)                 | 🟡 In Progress | Rules → questionnaire → intro → `verified`, plus reconciliation     |
| 04  | [plans/04-reminders-and-mod-tooling](plans/04-reminders-and-mod-tooling.md) | 🟡 In Progress | Reminder DMs, `/onboarding` mod commands, audit log                 |
| 05  | [plans/05-scale-hardening](plans/05-scale-hardening.md)                     | 🔵 Planning    | Priority queue, config cache, chunked reconcile, sharding, metrics  |

Archived in [`plans/archive/`](plans/archive/) — superseded single-guild drafts, kept for history.

## Current Focus

> Plan 04's code is complete — all 3 tasks done (reminder sweep, `/onboarding` command, command registration + hourly sweep wiring + README). `pnpm typecheck` and `pnpm test` both green (103 tests). Plan 04 stays 🟡 until its one human-only step is run: Task 3 Step 5 (verify the moderator commands by hand). Plan 05 (scale hardening) is next up — requires Plan 04, which is code-complete.
>
> Plans 02, 03, and 04 all sit at 🟡 for the same reason: code and tests are done, only live-Discord-client verification steps remain, yours to run whenever convenient (Plan 02: Task 5 Step 4, Task 6 Step 2; Plan 03: Task 7 Step 6, Task 8 Step 5; Plan 04: Task 3 Step 5).
>
> **Known doc gap (not yet fixed):** README's "Running at Scale" section already describes `pnpm dev:sharded`/`pnpm start:sharded`, `SHARD_COUNT`, and `src/observability/metrics.ts` as if built — none of it exists yet; it's Plan 05's scope. Written prematurely in an earlier session pass. Needs a fix or a "planned" caveat before Plan 05 lands.

## Blockers

> None.

## Completed

> - Plan 01 — Bot foundation & multi-guild data layer (2026-08-11)

---

## Obsidian Vault

[discord-developer](obsidian://open?vault=Documents&file=JF%2FCLAUDE%2Fdiscord-developer%2FPROJECT)
