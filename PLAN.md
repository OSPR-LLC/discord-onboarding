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
| 05  | [plans/05-scale-hardening](plans/05-scale-hardening.md)                     | 🟡 In Progress | Priority queue, config cache, chunked reconcile, sharding, metrics  |

Archived in [`plans/archive/`](plans/archive/) — superseded single-guild drafts, kept for history.

## Current Focus

> Plan 05, Task 6 — observability (`src/observability/metrics.ts`). Tasks 1–5 (priority task queue, queued `DiscordPort` decorator, cached guild config repository, chunked/yielding reconciliation, sharding entrypoint) are complete and verified. `pnpm typecheck` and `pnpm test` both green (136 tests). Task 5's two human-only steps (verify sharding locally, verify concurrent-shard DB writes) remain open for you. **Resolved:** README's "Running at Scale" doc gap — `pnpm start:sharded`/`SHARD_COUNT` and the decisions doc now genuinely exist; only the `src/observability/metrics.ts` reference is still forward-looking, and Task 6 closes that.
>
> Added to CLAUDE.md's Hard Rules: `SHARD_COUNT` joins the allowed env-var list (deployment topology, like `DATABASE_PATH` — not guild config). Confirmed with you before making the change.
>
> Plans 02, 03, and 04 all sit at 🟡 for the same reason: code and tests are done, only live-Discord-client verification steps remain, yours to run whenever convenient (Plan 02: Task 5 Step 4, Task 6 Step 2; Plan 03: Task 7 Step 6, Task 8 Step 5; Plan 04: Task 3 Step 5).
>
> **Resolved doc gap:** README's "Running at Scale" section described sharding scripts and `src/observability/metrics.ts` before they existed. Rather than caveat the wording, we're building the real thing — Plan 05 Task 5 (sharding entrypoint) and Task 6 (observability) will make that section literally true. Until Task 6 lands, the section is aspirational but on a concrete path to accurate.

## Blockers

> None.

## Completed

> - Plan 01 — Bot foundation & multi-guild data layer (2026-08-11)

---

## Obsidian Vault

[discord-developer](obsidian://open?vault=Documents&file=JF%2FCLAUDE%2Fdiscord-developer%2FPROJECT)
