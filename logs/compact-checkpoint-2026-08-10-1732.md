---
type: compact-checkpoint
project: discord-developer
tags: [log, compact-checkpoint]
date: 2026-08-10
time: 17:32
---

# Pre-Compact Checkpoint — 2026-08-10-1732

## Plan State at Compaction

[1;35;40m[K|[m[K # | Plan | Status | Notes |
[1;35;40m[K|[m[K---|------|--------|-------|
[1;35;40m[K|[m[K 01 | [plans/01-bot-foundation](plans/01-bot-foundation.md) | 🔵 Planning | Scaffold, multi-guild schema, both repositories, client bootstrap |
[1;35;40m[K|[m[K 02 | [plans/02-guild-configuration](plans/02-guild-configuration.md) | 🔵 Planning | `/config` commands, preflight, enable gate + grandfathering, README |
[1;35;40m[K|[m[K 03 | [plans/03-verification-gate](plans/03-verification-gate.md) | 🔵 Planning | Rules → questionnaire → intro → `verified`, plus reconciliation |
[1;35;40m[K|[m[K 04 | [plans/04-reminders-and-mod-tooling](plans/04-reminders-and-mod-tooling.md) | 🔵 Planning | Reminder DMs, `/onboarding` mod commands, audit log |
[1;35;40m[K|[m[K 05 | [plans/05-scale-hardening](plans/05-scale-hardening.md) | 🔵 Planning | Priority queue, config cache, chunked reconcile, sharding, metrics |

## Open Tasks (all plans)

- [ ] [1;35;40m[K- [ ][m[K **Step 1: Add the command to registration**
- [ ] [1;35;40m[K- [ ][m[K **Step 1: Add the shard count env var to `src/env.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 1: Initialise the repo**
- [ ] [1;35;40m[K- [ ][m[K **Step 1: Write `src/core/discord-port.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 1: Write `src/db/schema.sql`**
- [ ] [1;35;40m[K- [ ][m[K **Step 1: Write `src/discord/client.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 1: Write `src/discord/commands/config.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 1: Write `src/discord/commands/intro.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 1: Write `src/discord/commands/onboarding.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 1: Write `src/discord/port.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 1: Write `src/discord/preflight.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 1: Write `src/discord/register-commands.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 1: Write a shared config resolver**
- [ ] [1;35;40m[K- [ ][m[K **Step 1: Write the failing test (append to the existing file)**
- [ ] [1;35;40m[K- [ ][m[K **Step 1: Write the failing test**
- [ ] [1;35;40m[K- [ ][m[K **Step 1: Write the load test**
- [ ] [1;35;40m[K- [ ][m[K **Step 1: Write the README**
- [ ] [1;35;40m[K- [ ][m[K **Step 10: Commit**
- [ ] [1;35;40m[K- [ ][m[K **Step 2: Install dependencies**
- [ ] [1;35;40m[K- [ ][m[K **Step 2: Route the command**
- [ ] [1;35;40m[K- [ ][m[K **Step 2: Run it to confirm it fails**
- [ ] [1;35;40m[K- [ ][m[K **Step 2: Run it**
- [ ] [1;35;40m[K- [ ][m[K **Step 2: Verify it compiles**
- [ ] [1;35;40m[K- [ ][m[K **Step 2: Verify the README end to end**
- [ ] [1;35;40m[K- [ ][m[K **Step 2: Wire into `src/index.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 2: Write `src/discord/events/guild-member-add.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 2: Write `src/discord/safe-handler.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 2: Write `src/shard.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 2: Write `tests/helpers/fake-discord-port.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 2: Write the failing test**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Add the script to `package.json`**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Also ensure a config row exists when a guild is left and rejoined**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Commit**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Modify `src/tasks/reconcile.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Run it to confirm it fails**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Start the hourly sweep in `src/index.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Verify it compiles**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Write `package.json` scripts and module type**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Write `src/core/gate.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Write `src/core/guild-config.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Write `src/core/onboarding-service.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Write `src/core/task-queue.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Write `src/db/cached-guild-config-repository.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Write `src/db/guild-config-repository.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Write `src/db/onboarding-repository.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Write `src/discord/components/custom-ids.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Write `src/discord/components/questionnaire.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Write `src/discord/events/message-create.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Write `src/discord/queued-port.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Write `src/env.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Write `src/index.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Write `src/observability/metrics.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Write `src/tasks/reconcile.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Write `src/tasks/reminder-sweep.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 3: Write `src/types.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 4: Commit**
- [ ] [1;35;40m[K- [ ][m[K **Step 4: Make startup logs shard-aware in `src/index.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 4: Run the test to confirm it passes**
- [ ] [1;35;40m[K- [ ][m[K **Step 4: Update the `reconcile` wrapper to use the bulk port and log progress**
- [ ] [1;35;40m[K- [ ][m[K **Step 4: Verify it compiles**
- [ ] [1;35;40m[K- [ ][m[K **Step 4: Verify the full suite**
- [ ] [1;35;40m[K- [ ][m[K **Step 4: Verify the whole flow by hand**
- [ ] [1;35;40m[K- [ ][m[K **Step 4: Write `src/db/migrate.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 4: Write `src/discord/components/rules-message.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 4: Write `src/discord/events/interaction-create.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 4: Write `tsconfig.json`**
- [ ] [1;35;40m[K- [ ][m[K **Step 5: Commit**
- [ ] [1;35;40m[K- [ ][m[K **Step 5: Reconcile guilds sequentially, not in parallel, in `src/index.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 5: Run the test to confirm it passes**
- [ ] [1;35;40m[K- [ ][m[K **Step 5: Verify against the test guild**
- [ ] [1;35;40m[K- [ ][m[K **Step 5: Verify it fails loudly with no token**
- [ ] [1;35;40m[K- [ ][m[K **Step 5: Verify sharding works locally**
- [ ] [1;35;40m[K- [ ][m[K **Step 5: Verify the moderator commands by hand**
- [ ] [1;35;40m[K- [ ][m[K **Step 5: Wire into `src/index.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 5: Wire it in `src/index.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 5: Wire it into `src/index.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 5: Write `tests/helpers/test-db.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 5: Write `tsconfig.test.json`**
- [ ] [1;35;40m[K- [ ][m[K **Step 6: Commit**
- [ ] [1;35;40m[K- [ ][m[K **Step 6: Run the test to confirm it passes**
- [ ] [1;35;40m[K- [ ][m[K **Step 6: Run the tests**
- [ ] [1;35;40m[K- [ ][m[K **Step 6: Update the README**
- [ ] [1;35;40m[K- [ ][m[K **Step 6: Verify it connects and records guilds**
- [ ] [1;35;40m[K- [ ][m[K **Step 6: Verify the database survives concurrent shards**
- [ ] [1;35;40m[K- [ ][m[K **Step 6: Verify the stats line is useful**
- [ ] [1;35;40m[K- [ ][m[K **Step 6: Walk the whole flow by hand**
- [ ] [1;35;40m[K- [ ][m[K **Step 6: Write `vitest.config.ts`**
- [ ] [1;35;40m[K- [ ][m[K **Step 7: Commit**
- [ ] [1;35;40m[K- [ ][m[K **Step 7: Document it in the README**
- [ ] [1;35;40m[K- [ ][m[K **Step 7: Write `.gitignore`**
- [ ] [1;35;40m[K- [ ][m[K **Step 8: Commit**
- [ ] [1;35;40m[K- [ ][m[K **Step 8: Write `.env.example`**
- [ ] [1;35;40m[K- [ ][m[K **Step 9: Verify the toolchain runs**
- [ ] [1;35;40m[K- [ ][m[K None.
- [ ] [1;35;40m[K- [ ][m[K None. The Postgres migration trigger is defined (sustained write contention visible in the lag metric) but is deliberately not built now.

## Recent Decisions (00-overview.md)
