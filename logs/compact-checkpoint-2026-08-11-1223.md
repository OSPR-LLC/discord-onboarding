---
type: compact-checkpoint
date: 2026-08-11
time: 12:23
---

# Pre-Compact Checkpoint — 2026-08-11-1223

## Plan State at Compaction

| #   | Plan                                                                        | Status         | Notes                                                               |
| --- | --------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------- |
| 01  | [plans/01-bot-foundation](plans/01-bot-foundation.md)                       | ✅ Complete    | Scaffold, multi-guild schema, both repositories, client bootstrap   |
| 02  | [plans/02-guild-configuration](plans/02-guild-configuration.md)             | 🟡 In Progress | `/config` commands, preflight, enable gate + grandfathering, README |
| 03  | [plans/03-verification-gate](plans/03-verification-gate.md)                 | 🟡 In Progress | Rules → questionnaire → intro → `verified`, plus reconciliation     |
| 04  | [plans/04-reminders-and-mod-tooling](plans/04-reminders-and-mod-tooling.md) | 🟡 In Progress | Reminder DMs, `/onboarding` mod commands, audit log                 |
| 05  | [plans/05-scale-hardening](plans/05-scale-hardening.md)                     | 🟡 In Progress | Priority queue, config cache, chunked reconcile, sharding, metrics  |
| 06  | [plans/06-intro-template-message](plans/06-intro-template-message.md)       | 🟡 In Progress | Configurable, pinned intro template on `/config enable`             |
| 07  | [plans/07-configurable-questionnaire](plans/07-configurable-questionnaire.md) | 🟡 In Progress | Admin-configurable questionnaire replacing the 3 fixed questions |

## Open Tasks (all plans)

- [ ] **Step 2: Verify the README end to end** _(requires literally following it against a fresh throwaway guild — yours to run)_
- [ ] **Step 4: Verify the whole flow by hand** _(requires typing slash commands in a live Discord client — yours to run)_
- [ ] **Step 5: Verify against the test guild**
- [ ] **Step 5: Verify sharding works locally**
- [ ] **Step 5: Verify the moderator commands by hand**
- [ ] **Step 6: Verify the database survives concurrent shards**
- [ ] **Step 6: Verify the stats line is useful**
- [ ] **Step 6: Walk the whole flow by hand**
- [ ] **Step 8: Verify against a live guild**
- [ ] None.
- [ ] None. The Postgres migration trigger is defined (sustained write contention visible in the lag metric) but is deliberately not built now.
- [ ] Where will `docs/legal/terms-of-service.md` and `docs/legal/privacy-policy.md` be hosted at a public URL? Discord's app verification form (Developer Portal → App) checks the Terms of Service URL and Privacy Policy URL fields directly — a committed file isn't enough. Options: GitHub Pages off this repo, raw GitHub content links, or wherever hosting eventually lands (currently `TBD`, see `CLAUDE.md` Infra)

## Recent Decisions (00-overview.md)

