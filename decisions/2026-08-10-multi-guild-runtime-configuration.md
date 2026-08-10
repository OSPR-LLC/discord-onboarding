---
type: adr
date: 2026-08-10
status: Accepted
project: discord-developer
tags: [adr, decision]
---

# ADR: Multi-guild support via runtime configuration, gated behind an explicit enable step

## Status

Accepted. Supersedes the single-guild environment-variable configuration described in [[2026-08-04-bot-stack]].

## Context

The bot was originally designed for one specific server, with every setting — guild id, three channel ids, two role ids — supplied as environment variables and read once at boot. Reconfiguring meant editing `.env` and restarting.

The requirement changed: the bot must work as an onboarding bot for any server that invites it, configurable by that server's admins without a redeploy. Environment variables cannot express per-guild settings, and a server admin has no access to the host's environment regardless.

A second, sharper problem surfaced during the pre-development plan review. Startup reconciliation treats "member has no onboarding record" as "new member, apply the `unverified` role". In a single-guild deployment against a fresh test server that is correct. In a multi-guild bot, being invited to an established 10,000-member community would strip access from every existing member in one burst of role writes — a catastrophic, hard-to-reverse first impression.

## Decision

**Configuration moves from environment variables into a `guild_config` table**, one row per guild, edited at runtime through `/config` slash commands (gated on Manage Server). Only `DISCORD_TOKEN` and `DATABASE_PATH` remain in the environment, since neither is server-specific.

**The onboarding tables are re-keyed on `(guild_id, user_id)`.** The same person in two servers has two independent records, including independent questionnaire answers.

Because `guild_config` columns are nullable while a guild is configured incrementally, a `resolveGuildConfig` narrowing function converts a partial row into either a fully-populated `ResolvedGuildConfig` or a list of named missing fields. The domain layer accepts only the resolved type, making a half-configured guild unrepresentable past that boundary.

**Activation is explicit and gated.** `guild_config.enabled` starts at `0`, and a disabled guild is completely inert — the bot receives its events and ignores them. `/config enable` runs a live preflight (role hierarchy, channel visibility, bot permissions) and refuses with named problems if anything is wrong.

**Enabling stamps `grandfather_before` with the current timestamp.** Every member who joined before that instant is permanently exempt from the gate; reconciliation skips them. The gate applies only to members who join after an admin deliberately switched it on. `/config enable` reports the grandfathered count so the admin can see the blast radius is zero. Subjecting existing members to the gate requires a separate explicit `/config grandfather clear`.

## Consequences

- Any server can use the bot with no code, config file, or restart — the original requirement is met.
- Inviting the bot is safe by construction. The worst outcome of a careless invite is a bot that sits there doing nothing, rather than one that locks a community out of its own server.
- Preflight moves from a startup check that logs to the console (invisible to a server admin) into a command response the admin actually reads, at the moment they are trying to turn it on. Configuration errors now surface to the person able to fix them.
- Slash commands register globally rather than per-guild, so they appear in every server automatically. The cost is up to an hour of propagation delay after a command definition changes; `DEV_GUILD_ID` registers to a single guild instantly to keep development iteration fast.
- The `DiscordPort` interface gains a `guildId` parameter on every method, and a single port instance resolves the guild per call rather than one port being constructed per guild.
- Grandfathering is permanent per guild rather than time-boxed. A member who joined a server two years before the bot arrived is never asked to onboard, which is the intended behaviour — retroactively gating an existing community is a decision only its admins should make, explicitly.
- Every gateway event handler now needs an error boundary. In a single-guild bot an unhandled rejection taking the process down was an annoyance; in a multi-guild bot it is an outage for every server being served.
