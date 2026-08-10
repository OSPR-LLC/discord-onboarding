@~/.claude/CLAUDE.md

# CLAUDE.md — discord-developer

> Auto-loaded every session. Keep current.

## Project Overview

> A reusable Discord onboarding bot that **any server can add**. Server admins configure it at runtime with `/config` slash commands — nothing server-specific lives in env vars or config files. Once enabled, members who join must accept the rules, complete a three-question intro questionnaire, and post an introduction before the bot automatically grants a `verified` role. Full design: `docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md`. No web UI — all interaction happens through native Discord message components (modals, buttons, select menus).

## Hard Rules

- **The bot never kicks or bans anyone.** Reminders cap at two, then stop.
- **A guild is inert until an admin runs `/config enable`.** Every handler resolves config and returns early otherwise.
- **Never restrict a member who joined before the guild was enabled.** `grandfather_before` is checked before any role change, in every code path.
- Only `DISCORD_TOKEN`, `DATABASE_PATH` and optional `DEV_GUILD_ID` are environment variables. Everything else is per-guild in SQLite.
- `showModal` must be an interaction's first response — never `reply()` before delegating to a handler that may open a modal.
- Every gateway listener is wrapped in `safeHandler`; an unhandled rejection takes the process down for every guild.
- **No `worker_threads`.** This workload is I/O bound and capped by Discord's per-bot rate limits; threads contend for the same budget and produce more 429s, not more throughput. Scale via process sharding + the priority queue. See `decisions/2026-08-10-concurrency-and-scale-model.md`.
- Every Discord write goes through the priority queue. Interactive work always outranks bulk work; bulk may be rejected when full, interactive never is.
- Prepare SQL once at repository construction, never per call. Bulk loops must chunk and yield.

## Tech Stack

- Language: TypeScript (strict mode)
- Framework: Node.js 20+ + discord.js v14
- Styling: N/A — Discord-only, no web UI
- Database: SQLite via `better-sqlite3`
- Infra: TBD — local run only for now; hosting is a separate future spec

## Code Conventions

- Naming: named exports only, kebab-case filenames, no classes for state
- `module`/`moduleResolution` are `NodeNext`; every relative import ends in `.js`
- File structure: three layers, dependencies point inward — `src/discord/` (adapters, the only layer allowed to import discord.js) → `src/core/` (domain: gate evaluation, config resolution, onboarding service) → `src/db/` (SQLite repositories, plain functions, no ORM)
- Onboarding tables are keyed `(guild_id, user_id)`; every repository method takes `guildId` first
- `src/core/` accepts only `ResolvedGuildConfig`, never loose ids — a half-configured guild is unrepresentable below the adapter layer
- `pnpm typecheck` covers `tests/` too (Vitest does not typecheck)

## SCSS

N/A — no web UI surface, no SCSS in this project.

## Do Not Touch

-

## Plans & Logs

Sub-plans in `plans/`. Mark `[x]` as completed. Append session summaries to `logs/YYYY-MM-DD.md`.
