---
plan: onboarding-questionnaire
project: discord-developer
updated: 2026-08-04
status: 🔵 Planning
tags: [plan]
---

# 01 — Discord bot intro questionnaire flow

> ⚠️ **SUPERSEDED — archived 2026-08-08.** This is the single-guild draft, replaced by the
> multi-guild rework. Do not implement from this file. The current plans are
> [[01-bot-foundation]], [[02-guild-configuration]], [[03-verification-gate]] and
> [[04-reminders-and-mod-tooling]]. Kept only for history.

## Status

🔵 Planning

## Goal

> When a new member joins the "Developer Discord" server (or runs an intro/onboarding command), the bot walks them through a short series of questions and records their answers:
>
> 1. What's your purpose here?
> 2. What's your level of understanding in terms of web/software development?
>    - New to everything
>    - I have a little bit of experience
>    - I write web and/or software
>    - Advanced/guru status
> 3. Have you ever developed anything for Discord?
>
> Done = a new member can complete the flow end-to-end (via slash command and/or automatic on-join trigger), their answers are captured, and downstream effects (e.g. role assignment, welcome message, logging) are wired up.

## Tasks

> ⚠️ **This task list is stale.** It predates the verification-gate design and covers only the questionnaire.
> The authoritative source is the spec linked under Decisions below. These tasks are being replaced by a
> proper breakdown (bot foundation → gate flow → mod tooling) via `superpowers:writing-plans`.
> Do not start work from this list.

- [ ] Decide trigger: slash command (e.g. `/intro`) vs. automatic DM/prompt on `guildMemberAdd`, or both
- [ ] Design question 1 as a modal text input (free-form "purpose" answer)
- [ ] Design question 2 as a button row or select menu (4 fixed choices)
- [ ] Design question 3 as a button row (yes/no, possibly with follow-up "what did you build?" text input if yes)
- [ ] Implement per-user flow state (in-memory or persisted) so answers collected across multiple interactions can be assembled into one record
- [ ] Persist completed responses (storage choice: file/SQLite/Postgres — TBD, see Open Questions)
- [ ] Wire up downstream effect: assign Discord role(s) based on question 2 answer
- [ ] Send a tailored welcome/confirmation message summarizing their answers
- [ ] Handle edge cases: user abandons flow partway, user re-runs `/intro` after completing it, interaction token expiry (Discord's 15-min interaction window)

## Acceptance Criteria

- Running `/intro` (or joining the server, per trigger decision) starts the questionnaire
- All 3 questions are asked in sequence using native Discord components (modal + buttons/select), not plain-text chat parsing
- Question 2 only accepts one of the 4 listed options
- On completion, the user's answers are stored and retrievable
- A role is applied and/or a welcome message is sent reflecting their answers
- Re-running the command after completion is handled gracefully (e.g. shows existing answers or lets them redo it — decide during implementation)

## UI/UX Pattern

_N/A — no web UI surface. All interaction happens through native Discord message components (modals, buttons, select menus), which are bot-defined, not styled/designed the way a web page is._

## Open Questions

- [x] Trigger: slash command only, automatic on-join, or both? → **Automatic on join** (`unverified` role + best-effort DM), persistent rules button in #rules, `/intro` as re-entry point
- [x] Storage: in-memory, flat file/JSON, SQLite, or Postgres? → **SQLite via better-sqlite3**
- [x] Does question 2's answer map to a Discord role? → **No.** Answer is stored only; `verified`/`unverified` are the only roles
- [x] Should question 3 have a follow-up free-text question when yes? → **No.** Three questions only
- [x] Is there a moderation/review step before a role is granted? → **No.** Grant is automatic once all three steps complete; mods have override commands after the fact

## Dependencies

- Requires: —
- Blocks: —

## Decisions

- 2026-08-08 — Superseded by [`docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md`](../docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md). The questionnaire is now one of three steps in a verification gate (rules → questionnaire → #introductions post → `verified`), not a standalone flow.
- 2026-08-08 — Gate decision centralised in a single `evaluateGate` function called after every step; a `verification_hold_at` column prevents `/onboarding unverify` from being instantly undone by the gate re-running.
