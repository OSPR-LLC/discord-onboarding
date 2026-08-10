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
| 01  | [plans/01-bot-foundation](plans/01-bot-foundation.md)                       | 🟡 In Progress | Scaffold, multi-guild schema, both repositories, client bootstrap   |
| 02  | [plans/02-guild-configuration](plans/02-guild-configuration.md)             | 🔵 Planning    | `/config` commands, preflight, enable gate + grandfathering, README |
| 03  | [plans/03-verification-gate](plans/03-verification-gate.md)                 | 🔵 Planning    | Rules → questionnaire → intro → `verified`, plus reconciliation     |
| 04  | [plans/04-reminders-and-mod-tooling](plans/04-reminders-and-mod-tooling.md) | 🔵 Planning    | Reminder DMs, `/onboarding` mod commands, audit log                 |
| 05  | [plans/05-scale-hardening](plans/05-scale-hardening.md)                     | 🔵 Planning    | Priority queue, config cache, chunked reconcile, sharding, metrics  |

Archived in [`plans/archive/`](plans/archive/) — superseded single-guild drafts, kept for history.

## Current Focus

> Plan 01, Task 7 (final) — client bootstrap. Tasks 1–6 (scaffold, domain types, env loading, schema + migration, both repositories) are complete and verified; awaiting commit.

## Blockers

> None.

## Completed

> Move finished phases here.

---

## Obsidian Vault

[discord-developer](obsidian://open?vault=Documents&file=JF%2FCLAUDE%2Fdiscord-developer%2FPROJECT)
