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
| 06  | [plans/06-intro-template-message](plans/06-intro-template-message.md)       | 🟡 In Progress | Configurable, pinned intro template on `/config enable`             |
| 07  | [plans/07-configurable-questionnaire](plans/07-configurable-questionnaire.md) | 🟡 In Progress | Admin-configurable questionnaire replacing the 3 fixed questions |
| 08  | [plans/08-questionnaire-answer-validation](plans/08-questionnaire-answer-validation.md) | 🟡 In Progress | Numeric-only and character-limit validation for text questions |
| 09  | [plans/09-numeric-range-dropdown-options](plans/09-numeric-range-dropdown-options.md) | 🔵 Planning | Numeric-range shorthand (e.g. 1988-2026) for dropdown options |

Archived in [`plans/archive/`](plans/archive/) — superseded single-guild drafts, kept for history.

## Current Focus

> **Plans 01–09 are all code-complete.** Plans 06, 07, 08, and 09 all landed in response to a direct user request — not in the original spec — and are fully implemented: Plan 06 (configurable, pinned introduction template) includes schema + guarded migration, repository layer, `/config intro-template` command mirroring `/config rules-text`, wired into `enable`. Plan 07 (configurable questionnaire) replaces the hardcoded three questions with a per-guild admin-configurable question set via `/config question add/edit/remove/move/list/clear`, each question free-text or select (single/multi), each independently required. The old fixed-column `questionnaire_answers` table was dropped and recreated in normalized shape — a deliberate, accepted data-loss migration since no guild had live answer data yet. Plan 08 (questionnaire answer validation) adds numeric-only and character-limit validation to text questions — character limits enforced natively in Discord's modal UI, numeric-only checked server-side with a "Try Again" retry button. Its final review caught and fixed two cross-task seams before merge: a whitespace-only answer bypassing numeric validation on a required question, and a text question with a length limit set being permanently unable to change type. Plan 09 (numeric-range dropdown options) lets select-type questions use range-shorthand like `2017-2026` instead of requiring every value typed out individually. `pnpm typecheck` and `pnpm test` both green (218 tests). No `worker_threads` import exists anywhere in the codebase, confirmed by grep.
>
> Every plan from 02 onward sits at 🟡 for the same reason — code and tests done, only hands-on Discord-client verification remains, yours to run whenever convenient:
>
> - Plan 02: Task 5 Step 4, Task 6 Step 2
> - Plan 03: Task 7 Step 6, Task 8 Step 5
> - Plan 04: Task 3 Step 5
> - Plan 05: Task 5 Step 5 (sharding end-to-end + onboarding under sharding — partially verified already, see Task 5's notes for the two real bugs found and fixed live), Task 5 Step 6 (concurrent-shard DB writes), Task 6 Step 6 (stats line against a live run)
> - Plan 06: Task 3 Step 8 (confirm the template posts/pins live, and that repeat edits stay in place)
> - Plan 07: Create a few questions of each type via `/config question add` and walk `/intro` through them by hand
> - Plan 08: Add a numeric-only question with a length limit via `/config question add`, and confirm both the character limit (rejected by Discord's own modal UI) and a non-numeric answer (rejected server-side with a Try Again button) behave as expected. Also add an *optional* text question with `min_length` set and confirm an empty submit is still accepted (text questions have no skip button, unlike select questions — worth a live check since it can't be verified locally)
> - Plan 09: Add a select question via `/config question add` with `options:2020-2025` and confirm the dropdown shows five individual year choices
>
> No new task to start — next session's work is either running through this checklist, or scoping what comes next.
>
> **Resolved doc gap:** README's "Running at Scale" section is fully backed by real code now (sharding scripts, `SHARD_COUNT`, `src/observability/metrics.ts` all exist). Its Status line, which had gone stale describing Plan 03 as "next" long after 03–05 were done, is also fixed.

## Blockers

> None.

## Completed

> - Plan 01 — Bot foundation & multi-guild data layer (2026-08-11)

---

## Obsidian Vault

[discord-developer](obsidian://open?vault=Documents&file=JF%2FCLAUDE%2Fdiscord-developer%2FPROJECT)
