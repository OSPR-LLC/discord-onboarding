---
type: adr
date: 2026-08-10
status: Accepted
project: discord-developer
tags: [adr, decision, performance]
---

# ADR: Scale through process sharding and rate-limit-aware queues, not worker threads

## Status

Accepted.

## Context

The goal is for this bot to serve as many servers as possible, as fast as possible. The obvious instinct is to reach for `worker_threads` and parallelise. Before committing to that, the actual workload was characterised.

**Where the time goes, per onboarding event:**

| Work                                          | Cost                                     |
| --------------------------------------------- | ---------------------------------------- |
| `evaluateGate`                                | Four null checks. Sub-microsecond        |
| `resolveGuildConfig`                          | Five field checks                        |
| SQLite read/write                             | Tens of microseconds, local, synchronous |
| Building an embed                             | String concatenation                     |
| **Discord REST call** (role add, DM, message) | **50–500 ms, network**                   |

The CPU work is effectively zero. Essentially 100% of wall-clock time is I/O waiting on Discord. Node's event loop already multiplexes concurrent I/O across a single thread; adding threads does not make an HTTP response arrive sooner.

**The actual ceiling is Discord's rate limits, and they are per-bot, not per-thread:**

- ~50 requests/second global for a bot token
- Per-route buckets — role changes are bucketed _per guild_
- 10,000 invalid requests in 10 minutes gets the token temporarily banned
- Sharding becomes **mandatory** at 2,500 guilds

A concrete consequence: reconciling a 10,000-member guild means 10,000 role calls. At a safe per-guild route rate that is **twenty to thirty minutes of wall clock**, no matter how many threads are running. Spawning workers would only add threads contending for the same rate-limit bucket, and would require cross-thread limit coordination that discord.js provides for free inside one process. More threads would produce _more_ 429s, not more throughput.

`better-sqlite3` compounds the argument against threads: it is synchronous and a single file cannot take concurrent writers from multiple threads without `SQLITE_BUSY` contention.

**Write volume is also not a bottleneck.** Onboarding events are rare per member — a handful over their entire membership. Even 1,000 active guilds seeing 100 joins a day each is roughly one write per second. SQLite absorbs that without noticing.

## Decision

**Do not use `worker_threads` for request handling.** The parallelism that matters here is at the process level and is mandated by Discord anyway.

Scale is pursued along five axes instead:

1. **Process sharding.** `ShardingManager` spawns one process per shard, each owning a subset of guilds. This is Discord's own scaling model, required past 2,500 guilds, and gives genuine OS-level parallelism across CPU cores. Shards share one SQLite file in WAL mode — safe because writes are rare and short.

2. **A rate-limit-aware priority queue in front of every Discord write.** Interactive work (a member clicking _I agree_) is queued ahead of bulk work (reconciliation, reminder sweeps). Without this, one large backfill starves live onboarding for half an hour.

3. **An in-memory guild config cache.** Config is read on _every_ gateway event; without caching that is a SQLite query per message in every served guild. The cache is invalidated on write and is the single highest-frequency win.

4. **Prepared statement reuse.** The repositories originally called `db.prepare()` on every invocation, recompiling SQL each time. Statements are now compiled once at repository construction.

5. **Bounded discord.js caches.** Default caching retains messages, users and presences indefinitely. Across thousands of guilds that is the dominant memory cost, and it buys nothing here — this bot never re-reads old messages.

## Consequences

- Throughput is governed by rate-limit budget and queue policy, which are now explicit and tunable, rather than by accident.
- Interactive latency stays flat while bulk work runs, which is the property users actually perceive.
- The design stays single-threaded per shard and therefore free of shared-mutable-state bugs — no locks, no cross-thread SQLite coordination, no rate-limit budget negotiation between threads.
- Sharding is transparent to the domain layer: `src/core/` never learns it exists.
- Grandfathering, adopted for safety, turns out to be a major performance decision too. It removes the single largest bulk workload the bot could ever face — backfilling an established community — from the critical path entirely.
- **The escape hatch is defined rather than assumed.** A worker thread earns its place only if genuine CPU-bound work appears and profiling shows event-loop lag attributable to it. The metrics task exists partly to detect that. Nothing in the current feature set qualifies.
- **SQLite's limit is documented rather than discovered.** It is comfortable for this write volume. If the bot ever serves enough guilds that WAL write contention shows up in the lag metric, the repository interface is the swap point for Postgres; nothing above it changes.
