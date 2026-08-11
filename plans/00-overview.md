---
plan: overview
project: discord-developer
updated: 2026-08-11
status: 🟡 In Progress
tags: [plan]
---

# Overview Plan — discord-developer

## Status

🟡 In Progress

## Goal

> A reusable Discord onboarding bot any server can add and configure from inside Discord. New members must accept the rules, complete a three-question questionnaire, and post an introduction before the bot grants a `verified` role. Full design in [`docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md`](../docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md).

## Architecture Decisions

- 2026-08-04 — Node.js + discord.js, TypeScript (type-safe interaction payloads, matches project-base typescript-conventions)
- 2026-08-04 — No web UI/dashboard; all interaction happens through native Discord components
- 2026-08-04 — Testing via Vitest
- 2026-08-08 — Onboarding is a three-step gate (rules → questionnaire → introductions post → `verified`), not a standalone questionnaire
- 2026-08-08 — Steps are independent nullable timestamps evaluated by one `evaluateGate` function, so they can complete in any order and the grant decision has a single test surface
- 2026-08-08 — A `verification_hold_at` column gates re-verification, so `/onboarding unverify` is not instantly undone by the next event
- 2026-08-08 — `MessageContent` intent deliberately not requested; the intro watcher only needs author + channel
- 2026-08-10 — **Multi-guild.** Per-server settings live in a `guild_config` table edited at runtime via `/config`; only `DISCORD_TOKEN` and `DATABASE_PATH` remain environment variables. See [[2026-08-10-multi-guild-runtime-configuration]]
- 2026-08-10 — Onboarding tables re-keyed on `(guild_id, user_id)`; the same member in two servers has independent records and answers
- 2026-08-10 — **Enable gate + grandfathering.** A guild is inert until an admin runs `/config enable`, which stamps a cutoff exempting every existing member. Without this, joining an established server would strip access from its entire membership
- 2026-08-10 — `grantVerified` applies the role before stamping the database, so a rejected Discord call leaves the member retryable rather than falsely recorded as verified
- 2026-08-10 — Every gateway listener is wrapped in an error boundary; an unhandled rejection would otherwise kill the process for every served guild at once
- 2026-08-10 — **Scale is pursued through process sharding + a rate-limit-aware priority queue, not `worker_threads`.** The workload is I/O bound and capped by Discord's per-bot rate limits, which threads cannot expand. See [[2026-08-10-concurrency-and-scale-model]]
- 2026-08-10 — Interactive work always outranks bulk work in one shared queue, so a reconciliation backfill never starves a member's button click
- 2026-08-10 — Guild config is cached in memory (invalidated per guild on write); it is read on every gateway event and was otherwise a SQLite query per message
- 2026-08-10 — All SQL compiles once at repository construction; discord.js message/presence caches are disabled and members swept
- 2026-08-10 — Terms of Service and Privacy Policy drafted for Discord app verification, operated by **OSPR**. Live in [`docs/legal/`](../docs/legal/)
- 2026-08-11 — **Configurable introduction template.** `/config enable` now also posts (and best-effort pins) a per-guild-customizable template message in the introductions channel, mirroring the existing `/config rules-text` pattern. Requested directly by the user, not in the original spec. The bot deliberately does not manage channel permissions to "force" members into `#rules` — that's documented as an admin's own Discord server setup step. See [[06-intro-template-message]]
- 2026-08-11 — **Configurable questionnaire.** The three hardcoded onboarding questions are replaced by a per-guild, admin-configurable question set (`/config question add/edit/remove/move/list/clear`), each question free-text or select (single/multi), each independently required. Requested directly by the user. The old fixed-column `questionnaire_answers` table was dropped and recreated in a normalized shape — a deliberate, accepted data-loss migration since no guild had live answer data yet. See [[07-configurable-questionnaire]]

## Module Plans

| Plan                                | Status         | Blocks                              |
| ------------------------------------ | -------------- | ------------------------------------ |
| [[01-bot-foundation]]                | ✅ Complete    | [[02-guild-configuration]]           |
| [[02-guild-configuration]]           | 🟡 In Progress | [[03-verification-gate]]             |
| [[03-verification-gate]]             | 🟡 In Progress | [[04-reminders-and-mod-tooling]]     |
| [[04-reminders-and-mod-tooling]]     | 🟡 In Progress | [[05-scale-hardening]]               |
| [[05-scale-hardening]]               | 🟡 In Progress | —                                    |
| [[06-intro-template-message]]        | 🟡 In Progress | —                                    |
| [[07-configurable-questionnaire]]    | 🟡 In Progress | —                                    |

## UI/UX Pattern

_N/A — no web UI surface. Member and admin interaction are both native Discord components._

## Open Questions

- [x] Trigger → **automatic on join**, persistent rules button, `/intro` re-entry
- [x] Answer storage → **SQLite** via `better-sqlite3`
- [x] Does the experience answer map to a role? → **No.** Stored only
- [x] How is the bot configured per server? → **`/config` slash commands**, stored in `guild_config`
- [x] What stops the bot restricting an existing community? → **Enable gate + grandfather cutoff**
- [ ] Where will `docs/legal/terms-of-service.md` and `docs/legal/privacy-policy.md` be hosted at a public URL? Discord's app verification form (Developer Portal → App) checks the Terms of Service URL and Privacy Policy URL fields directly — a committed file isn't enough. Options: GitHub Pages off this repo, raw GitHub content links, or wherever hosting eventually lands (currently `TBD`, see `CLAUDE.md` Infra)

## Dependencies

- External: Discord API / discord.js, a bot token and application
- External: Public hosting for `docs/legal/` (blocks Discord app verification — see Open Questions)
- Internal: —
