# Discord Developer Bot

A reusable Discord onboarding bot that **any server can add**. Server admins configure it at runtime with `/config` slash commands — nothing server-specific lives in env vars or config files.

Once enabled, members who join must accept the rules, complete a three-question intro questionnaire, and post an introduction before the bot automatically grants a `verified` role. There is no web UI — all interaction happens through native Discord message components (modals, buttons, select menus).

Full design: [`docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md`](docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md)

## Status

🟡 In Progress — all 5 plans are code-complete (foundation, `/config`, the full verification gate, reminders/mod tooling, scale hardening) with `pnpm test` and `pnpm typecheck` green throughout. What's left everywhere is hands-on verification against a live Discord server — see [`PLAN.md`](PLAN.md) for the exact checklist.

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
SHARD_COUNT=         # optional — number of shards, or "auto" to let Discord decide. Unset/omitted runs a single process; see "Running at Scale"
```

**That's the entire environment surface.** Every per-server setting — channels, roles, rules text, enabled/disabled — is configured from inside Discord with `/config`, not in `.env` or any config file. This is what lets one deployment of the bot serve any number of unrelated servers.

### Getting a bot token

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** (or select an existing one).
2. Left sidebar → **Bot** → under **Token**, click **Reset Token** (first time) or **Copy**. Discord only shows the full token once — copy it straight into `.env` as `DISCORD_TOKEN`.
3. On the same page, enable **Server Members Intent** under Privileged Gateway Intents. **This one is not optional** — without it the bot never receives join events, and onboarding will silently do nothing on every new member with no error anywhere. Leave **Message Content Intent** off — this project never requests it (see Hard Rules above).
4. Treat the token like a password: never commit it (`.env` is already gitignored), never paste it anywhere public. If it ever leaks, hit **Reset Token** again to invalidate it immediately.

### Inviting the bot to a server

Build an invite URL by hand rather than using the portal's "Default Install Link" on the General Information page — **that link defaults to `scope=applications.commands` only**, which registers slash commands but never adds the bot as an actual guild member. The bot will authorize successfully and show "Added to \<server\>," but `pnpm dev` will report `guilds: 0` forever, because gateway `GUILD_CREATE` only fires for guilds the bot user is actually in.

Use this URL instead, with your application's **Client ID** (Developer Portal → General Information) and both scopes:

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=268528640&scope=bot%20applications.commands
```

`268528640` is the minimum permission set this bot needs:

| Permission           | Bit value     |
| -------------------- | ------------- |
| View Channels        | 1024          |
| Send Messages        | 2048          |
| Embed Links          | 16384         |
| Read Message History | 65536         |
| Manage Messages      | 8192          |
| Manage Roles         | 268435456     |
| **Total**            | **268528640** |

Manage Messages is used for exactly one thing: pinning the introduction template message
in the introductions channel when you run `/config enable`. If it's missing, pinning is
skipped silently (logged, not fatal) — everything else still works.

(Equivalently: Developer Portal → **OAuth2 → URL Generator** → check `bot` and `applications.commands` scopes, then check the same permissions under "Bot Permissions" — the page computes the URL for you.)

Opening the URL should show a consent screen listing real bot permissions (not just "Create commands") and a server picker requiring **Manage Server** in the target guild.

After inviting: open **Server Settings → Roles** and drag the bot's role **above** any role it needs to manage (`verified`/`unverified`) — `Manage Roles` alone doesn't let a bot touch roles positioned above its own. **This is the most common cause of silent role-assignment failure** — everything else succeeds, the bot just can't apply the role and there's no error visible in Discord's UI.

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

Nothing server-specific lives in env vars — every setting below is configured per-server, from inside Discord, by an admin with **Manage Server**.

```
/config show                                   # see what's set and what's still missing
/config channel rules #rules
/config channel introductions #introductions
/config channel modlog #mod-log
/config role verified @Verified
/config role unverified @Unverified
/config rules-text                             # opens a modal — paste your server's actual rules
/config intro-template                         # opens a modal — customize the introduction template
/config question add prompt:… type:… required:… options:… numeric:… min_length:… max_length:…   # add a questionnaire question
/config question edit position:… …                                                                # edit an existing question
/config question remove position:…                             # remove a question
/config question move position:… to:…                          # reorder questions
/config question list                                          # show the configured questions
/config question clear                                         # remove every question
/config enable
```

`/config show` works even on a completely unconfigured server and lists every missing setting by name — run it first, and again after each change, to see what's still needed. `/config enable` refuses (naming everything still missing) until all three channels and both roles are set, and again if the bot's role sits at or below either onboarding role in the hierarchy.

A successful `/config enable`:

- Stamps a `grandfather_before` cutoff — every member already in the server at that moment is **permanently exempt** from the gate. Only members who join afterward go through onboarding.
- Posts the rules message (with the "I agree" button) in the configured rules channel.
- Posts (and pins, if the bot has Manage Messages) the introduction template message in the introductions channel.
- Reports how many existing members were just grandfathered.

Both the rules text and the introduction template default to a generic version if you never customize them, and re-running `/config rules-text` / `/config intro-template` after `/config enable` edits the already-posted message in place rather than posting a duplicate.

The onboarding questionnaire is fully admin-configurable via `/config question` — any number of questions up to 10, each free-text or multiple-choice (single or multi-select), each independently required or optional, in whatever order you set. A server with zero configured questions skips the questionnaire step entirely, going straight from rules acceptance to the introduction post. See [`docs/superpowers/specs/2026-08-11-configurable-questionnaire-design.md`](docs/superpowers/specs/2026-08-11-configurable-questionnaire-design.md) for the full design, including why modal-only questions can't include multiple-choice options (a Discord platform constraint, not a choice). Text questions can additionally require digits-only answers and/or a character limit (`numeric`, `min_length`, `max_length` on `/config question add`/`edit`) — see [`docs/superpowers/specs/2026-08-11-questionnaire-answer-validation-design.md`](docs/superpowers/specs/2026-08-11-questionnaire-answer-validation-design.md).

To also require existing members to onboard, run `/config grandfather action:clear` — this clears the exemption cutoff, so members who joined before `/config enable` are no longer automatically exempt.

`/config disable` turns the bot off in that server without discarding any configuration or member records — running `/config enable` again picks up exactly where it left off.

See the [design spec](docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md) for the full command surface (`/config`, `/onboarding`, `/intro`).

### Restricting channels for new members

The bot only ever manages **roles** and **messages** — it never touches Discord's channel
permission overwrites. To make `#rules` the only channel a brand-new member can see (so
they're effectively "forced" through it), configure this directly in Discord:

1. **`#rules`** → Edit Channel → Permissions → for `@Unverified`, explicitly **allow** View
   Channel and Send Messages (needed to click "I agree" and see the button). For `@everyone`,
   **deny** View Channel here if you don't want non-members seeing it either.
2. **Every other member channel** (including `#introductions`) → for `@Unverified`, **deny**
   View Channel. `@Unverified` only needs `#rules` — the bot's own DM to new members and the
   in-flow prompts are what point them back through the questionnaire; the introductions
   channel only needs to open up once they're ready to post there.
3. Once you want `#introductions` visible to members mid-flow (after rules, before the final
   post), instead **allow** View Channel + Send Messages there for `@Unverified` too, alongside
   `#rules` — this is the simplest setup and matches the built-in flow, since the bot tells
   members to go post there right after the questionnaire.
4. **`@Verified`** → allow View Channel on all your normal server channels, however you'd
   normally configure member access.

This is a one-time server setup step, not something `/config` manages — the bot has no
`Manage Channels`/`Manage Permissions` permission and never requests one.

## Moderator commands

`/onboarding` requires **Manage Roles** — members without it never see the command. It has four subcommands, all scoped to the server they're run in:

```
/onboarding status member:@someone      # progress through rules → questionnaire → intro → verified
/onboarding verify member:@someone      # force-verify, lifting any hold
/onboarding unverify member:@someone    # remove verification and place a hold
/onboarding reset member:@someone       # wipe their record entirely
```

`/onboarding unverify` and `/onboarding reset` do different things:

- **`unverify`** removes the `verified` role and applies a hold. Their completed steps (rules accepted, questionnaire answers, intro post) are kept — a hold only blocks the automatic re-grant, so posting again in the introductions channel does **not** re-verify them. `/onboarding verify` lifts the hold and restores the role.
- **`reset`** wipes the record completely. The member goes through onboarding again from the start, as if they had just joined.

`/onboarding status` against a member the bot has never seen reports "no record" rather than erroring, and against a disabled server explains that onboarding isn't set up yet.

## Reminders

Members who stall partway through onboarding get up to two reminder DMs — one at ~24 hours, one at ~72 hours after they joined — each listing only the steps they still have outstanding. After the second reminder, the bot goes silent. **The bot never kicks or bans anyone**, in any server, under any circumstance. A member with DMs closed is still marked as reminded so they aren't retried on every sweep.

The sweep runs once at startup and then hourly, across every enabled server in one process. One server's failure doesn't stop the sweep for the others.

## Troubleshooting

| Symptom                                | Likely cause                                                                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| New members never get prompted to join | **Server Members Intent** isn't enabled for the bot application (Developer Portal → Bot → Privileged Gateway Intents)                   |
| Roles never get applied                | The bot's role sits **below** `verified`/`unverified` in Server Settings → Roles — drag it above both                                   |
| `/config` doesn't show up at all       | Global command registration takes up to an hour to propagate — set `DEV_GUILD_ID` in `.env` for instant registration during development |
| Nothing happens at all in a server     | The guild hasn't been enabled — run `/config show` to confirm, then `/config enable` once everything required is set                    |

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
| 06  | [intro-template-message](plans/06-intro-template-message.md)       | Configurable, pinned introduction template on `/config enable`     |
| 07  | [configurable-questionnaire](plans/07-configurable-questionnaire.md) | Admin-configurable questionnaire — question CRUD, dynamic delivery |

See [`PLAN.md`](PLAN.md) for current status.
