# Discord Developer Bot

A reusable Discord onboarding bot that **any server can add**. Server admins configure it at runtime with `/config` slash commands — nothing server-specific lives in env vars or config files.

Once enabled, members who join must accept the rules, complete a three-question intro questionnaire, and post an introduction before the bot automatically grants a `verified` role. There is no web UI — all interaction happens through native Discord message components (modals, buttons, select menus).

Full design: [`docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md`](docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md)

## Status

🟡 In Progress — plan 01 (bot foundation, multi-guild data layer, client bootstrap) is complete and verified against a live Discord connection. See [`PLAN.md`](PLAN.md) for phase status.

## Hard Rules

These constraints hold everywhere in the codebase:

- The bot never kicks or bans anyone. Reminders cap at two, then stop.
- A guild is inert until an admin runs `/config enable`. Every handler resolves config and returns early otherwise.
- A member who joined before the guild was enabled is never restricted — `grandfather_before` is checked before any role change, in every code path.
- Only `DISCORD_TOKEN`, `DATABASE_PATH`, and optional `DEV_GUILD_ID`/`SHARD_COUNT` are environment variables. Everything else is per-guild, stored in SQLite.
- `showModal` must be an interaction's first response — handlers never `reply()` before delegating to code that may open a modal.
- Every gateway listener is wrapped in a `safeHandler`; an unhandled rejection would otherwise take the process down for every served guild.
- No `worker_threads`. The workload is I/O-bound and capped by Discord's per-bot rate limits — see [`decisions/2026-08-10-concurrency-and-scale-model.md`](decisions/2026-08-10-concurrency-and-scale-model.md). Scale comes from process sharding and a priority queue instead.

## Tech Stack

| Layer           | Choice                                |
| --------------- | ------------------------------------- |
| Language        | TypeScript (strict mode)              |
| Runtime         | Node.js 20+                           |
| Discord         | discord.js v14                        |
| Database        | SQLite via `better-sqlite3`, WAL mode |
| Testing         | Vitest                                |
| Package manager | pnpm                                  |

## Project Structure

Three layers, dependencies point inward:

```
src/
  discord/     adapters — the only layer allowed to import discord.js
                 client.ts, commands/, interaction-create.ts, guild-member-add.ts, ...
  core/        domain logic — gate evaluation, config resolution, onboarding service
                 gate.ts, guild-config.ts, onboarding-service.ts, questionnaire.ts
  db/          SQLite repositories — plain functions, no ORM
                 schema.sql, migrate.ts, guild-config-repository.ts, onboarding-repository.ts
  tasks/       background jobs — reminder sweep, reconciliation
  observability/ metrics and lag monitoring
  types.ts     Result<T,E> and shared domain types
  env.ts       the handful of environment variables, validated
  index.ts     entrypoint
  shard.ts     ShardingManager entrypoint for running at scale
```

`src/core/` never imports discord.js and accepts only a fully-resolved `ResolvedGuildConfig` — a half-configured guild is unrepresentable below the adapter layer.

Onboarding tables are keyed `(guild_id, user_id)`; every repository method takes `guildId` first.

## Requirements

- Node.js 20+
- pnpm
- A Discord bot application + token ([Discord Developer Portal](https://discord.com/developers/applications)) with the `Guilds`, `GuildMembers`, and `GuildMessages` gateway intents enabled — **not** `MessageContent`

## Setup

```bash
pnpm i
cp .env.example .env
```

Fill in `.env`:

```
DISCORD_TOKEN=       # your bot's token
DATABASE_PATH=./data/onboarding.db
DEV_GUILD_ID=        # optional — registers commands to one guild instantly instead of waiting up to an hour for global propagation
```

### Getting a bot token

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** (or select an existing one).
2. Left sidebar → **Bot** → under **Token**, click **Reset Token** (first time) or **Copy**. Discord only shows the full token once — copy it straight into `.env` as `DISCORD_TOKEN`.
3. On the same page, enable **Server Members Intent** under Privileged Gateway Intents. Leave **Message Content Intent** off — this project never requests it (see Hard Rules above).
4. Treat the token like a password: never commit it (`.env` is already gitignored), never paste it anywhere public. If it ever leaks, hit **Reset Token** again to invalidate it immediately.

### Inviting the bot to a server

Build an invite URL by hand rather than using the portal's "Default Install Link" on the General Information page — **that link defaults to `scope=applications.commands` only**, which registers slash commands but never adds the bot as an actual guild member. The bot will authorize successfully and show "Added to \<server\>," but `pnpm dev` will report `guilds: 0` forever, because gateway `GUILD_CREATE` only fires for guilds the bot user is actually in.

Use this URL instead, with your application's **Client ID** (Developer Portal → General Information) and both scopes:

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=268504064&scope=bot%20applications.commands
```

`268504064` is the minimum permission set this bot needs:

| Permission           | Bit value     |
| -------------------- | ------------- |
| View Channels        | 1024          |
| Send Messages        | 2048          |
| Read Message History | 65536         |
| Manage Roles         | 268435456     |
| **Total**            | **268504064** |

(Equivalently: Developer Portal → **OAuth2 → URL Generator** → check `bot` and `applications.commands` scopes, then check the same permissions under "Bot Permissions" — the page computes the URL for you.)

Opening the URL should show a consent screen listing real bot permissions (not just "Create commands") and a server picker requiring **Manage Server** in the target guild.

After inviting: open **Server Settings → Roles** and drag the bot's role **above** any role it needs to manage (`verified`/`unverified`) — `Manage Roles` alone doesn't let a bot touch roles positioned above its own.

### Verifying the connection

```bash
pnpm dev
```

Expected: a `ready` log line reporting the guild count, e.g. `{"event":"ready","user":"YourBot#1234","guilds":1,"enabled":0}`. If you invite it to a guild while `pnpm dev` is already running, you should also see `{"event":"guild-joined","guildId":"..."}`. If `guilds` stays `0` after a "successful" invite, it's almost always the Default-Install-Link scope issue above — check the URL you used included `scope=bot` alongside `applications.commands`.

## Commands

| Task                                            | Command                          |
| ----------------------------------------------- | -------------------------------- |
| Dev server                                      | `pnpm dev`                       |
| Dev server, sharded (2 shards, one SQLite file) | `SHARD_COUNT=2 pnpm dev:sharded` |
| Build                                           | `pnpm build`                     |
| Start (built)                                   | `pnpm start`                     |
| Start, sharded                                  | `pnpm start:sharded`             |
| Tests                                           | `pnpm test`                      |
| Tests, watch                                    | `pnpm test:watch`                |
| Type check (source + tests)                     | `pnpm typecheck`                 |
| Format                                          | `pnpm format`                    |

## Running at Scale

A single process is fine below ~2,000 guilds. Above that, use `pnpm start:sharded` (`SHARD_COUNT=auto` lets Discord decide the shard count). All shards share one SQLite file safely — WAL mode handles concurrent readers, and write volume stays low even at scale. Postgres is the documented swap point if the lag metric in `src/observability/metrics.ts` ever shows write contention. See [`decisions/2026-08-10-concurrency-and-scale-model.md`](decisions/2026-08-10-concurrency-and-scale-model.md) for the full reasoning.

## Configuration

Nothing server-specific lives in env vars. Once the bot is in a server, an admin runs:

```
/config channel rules #rules
/config channel introductions #introductions
/config role verified @Verified
/config enable
```

`/config enable` stamps a `grandfather_before` cutoff — every member already in the server at that moment is permanently exempt from the gate. See the [design spec](docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md) for the full command surface (`/config`, `/onboarding`, `/intro`).

## Legal

Discord's Developer Portal requires a **Terms of Service URL** and **Privacy Policy URL** to pass app verification (Developer Portal → App → Terms of Service URL / Privacy Policy URL fields). The documents live in [`docs/legal/`](docs/legal/):

- [`docs/legal/terms-of-service.md`](docs/legal/terms-of-service.md)
- [`docs/legal/privacy-policy.md`](docs/legal/privacy-policy.md)

**These need to be reachable at public URLs, not just committed to the repo** — Discord's verification form checks the links, not the source. This project has no hosting yet (`Infra: TBD` — see `CLAUDE.md`), so pick one before submitting for verification: GitHub Pages off this repo, raw GitHub content links, or wherever the project ends up hosted. Tracked as an open question in [`plans/00-overview.md`](plans/00-overview.md).

## Plans

Implementation is broken into five sequential plans in [`plans/`](plans/):

| #   | Plan                                                               | Covers                                                             |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 01  | [bot-foundation](plans/01-bot-foundation.md)                       | Scaffold, multi-guild schema, repositories, client bootstrap       |
| 02  | [guild-configuration](plans/02-guild-configuration.md)             | `/config` commands, preflight, enable gate + grandfathering        |
| 03  | [verification-gate](plans/03-verification-gate.md)                 | Rules → questionnaire → intro → `verified`, reconciliation         |
| 04  | [reminders-and-mod-tooling](plans/04-reminders-and-mod-tooling.md) | Reminder DMs, `/onboarding` mod commands, audit log                |
| 05  | [scale-hardening](plans/05-scale-hardening.md)                     | Priority queue, config cache, chunked reconcile, sharding, metrics |

See [`PLAN.md`](PLAN.md) for current status.
