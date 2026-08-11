---
type: compact-checkpoint
project: discord-developer
tags: [log, compact-checkpoint]
date: 2026-08-10
time: 23:58
---

# Pre-Compact Checkpoint — 2026-08-10-2358

## Plan State at Compaction

| #   | Plan                                                                        | Status         | Notes                                                               |
| --- | --------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------- |
| 01  | [plans/01-bot-foundation](plans/01-bot-foundation.md)                       | ✅ Complete    | Scaffold, multi-guild schema, both repositories, client bootstrap   |
| 02  | [plans/02-guild-configuration](plans/02-guild-configuration.md)             | 🟡 In Progress | `/config` commands, preflight, enable gate + grandfathering, README |
| 03  | [plans/03-verification-gate](plans/03-verification-gate.md)                 | 🟡 In Progress | Rules → questionnaire → intro → `verified`, plus reconciliation     |
| 04  | [plans/04-reminders-and-mod-tooling](plans/04-reminders-and-mod-tooling.md) | 🔵 Planning    | Reminder DMs, `/onboarding` mod commands, audit log                 |
| 05  | [plans/05-scale-hardening](plans/05-scale-hardening.md)                     | 🔵 Planning    | Priority queue, config cache, chunked reconcile, sharding, metrics  |

## Open Tasks (all plans)

- [ ] **Step 1: Add the command to registration**
- [ ] **Step 1: Add the shard count env var to `src/env.ts`**
- [ ] **Step 1: Write `src/discord/commands/intro.ts`**
- [ ] **Step 1: Write `src/discord/commands/onboarding.ts`**
- [ ] **Step 1: Write a shared config resolver**
- [ ] **Step 1: Write the failing test (append to the existing file)**
- [ ] **Step 1: Write the failing test**
- [ ] **Step 1: Write the load test**
- [ ] **Step 2: Route the command**
- [ ] **Step 2: Run it to confirm it fails**
- [ ] **Step 2: Run it**
- [ ] **Step 2: Verify it compiles**
- [ ] **Step 2: Verify the README end to end** _(requires literally following it against a fresh throwaway guild — yours to run)_
- [ ] **Step 2: Write `src/discord/events/guild-member-add.ts`**
- [ ] **Step 2: Write `src/shard.ts`**
- [ ] **Step 3: Add the script to `package.json`**
- [ ] **Step 3: Commit**
- [ ] **Step 3: Modify `src/tasks/reconcile.ts`**
- [ ] **Step 3: Start the hourly sweep in `src/index.ts`**
- [ ] **Step 3: Write `src/core/task-queue.ts`**
- [ ] **Step 3: Write `src/db/cached-guild-config-repository.ts`**
- [ ] **Step 3: Write `src/discord/components/questionnaire.ts`**
- [ ] **Step 3: Write `src/discord/events/message-create.ts`**
- [ ] **Step 3: Write `src/discord/queued-port.ts`**
- [ ] **Step 3: Write `src/observability/metrics.ts`**
- [ ] **Step 3: Write `src/tasks/reconcile.ts`**
- [ ] **Step 3: Write `src/tasks/reminder-sweep.ts`**
- [ ] **Step 4: Make startup logs shard-aware in `src/index.ts`**
- [ ] **Step 4: Run the test to confirm it passes**
- [ ] **Step 4: Update the `reconcile` wrapper to use the bulk port and log progress**
- [ ] **Step 4: Verify the full suite**
- [ ] **Step 4: Verify the whole flow by hand** _(requires typing slash commands in a live Discord client — yours to run)_
- [ ] **Step 4: Write `src/discord/events/interaction-create.ts`**
- [ ] **Step 5: Commit**
- [ ] **Step 5: Reconcile guilds sequentially, not in parallel, in `src/index.ts`**
- [ ] **Step 5: Verify against the test guild**
- [ ] **Step 5: Verify sharding works locally**
- [ ] **Step 5: Verify the moderator commands by hand**
- [ ] **Step 5: Wire into `src/index.ts`**
- [ ] **Step 5: Wire it in `src/index.ts`**
- [ ] **Step 5: Wire it into `src/index.ts`**
- [ ] **Step 6: Commit**
- [ ] **Step 6: Run the tests**
- [ ] **Step 6: Update the README**
- [ ] **Step 6: Verify the database survives concurrent shards**
- [ ] **Step 6: Verify the stats line is useful**
- [ ] **Step 6: Walk the whole flow by hand**
- [ ] **Step 7: Commit**
- [ ] **Step 7: Document it in the README**
- [ ] **Step 8: Commit**

## Open Questions

- [ ] Where will `docs/legal/terms-of-service.md` and `docs/legal/privacy-policy.md` be hosted at a public URL? Discord's app verification form (Developer Portal → App) checks the Terms of Service URL and Privacy Policy URL fields directly — a committed file isn't enough. Options: GitHub Pages off this repo, raw GitHub content links, or wherever hosting eventually lands (currently `TBD`, see `CLAUDE.md` Infra)

## Recent Decisions (00-overview.md)
