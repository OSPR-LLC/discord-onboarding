---
type: adr
date: 2026-08-08
status: Accepted
project: discord-developer
tags: [adr, decision]
---

# ADR: Verification gate modeled as independent step timestamps, not a linear state machine

## Status

Accepted

## Context

Onboarding requires three steps — accept the rules, complete a questionnaire, post in `#introductions` — before a member is granted `verified`. The `#introductions` step is satisfied by the member typing their own message, which the bot cannot sequence or force to happen after the other two. Steps can therefore complete in any order (e.g. a member could post in `#introductions` before accepting the rules).

A linear wizard modeled as a single `current_step` enum was considered and rejected: every out-of-order completion would need its own recovery branch, and moderator overrides would risk writing the enum into an inconsistent state.

Separately, moderator tooling needs a way to revoke verification (`/onboarding unverify`) without that revocation being immediately undone. Because step completion is recorded permanently, simply clearing `verified_at` was not sufficient — the very next event touching that member would re-run the completion check, see all three steps still stamped, and re-grant the role.

## Decision

Each of the three steps is stored as its own nullable timestamp column (`rules_accepted_at`, `questionnaire_completed_at`, `intro_posted_at`) on a single `onboarding` row per member. Every code path that could complete a step — a button click, a modal submit, a message in `#introductions`, a moderator command, or the startup reconciliation sweep — writes its own step idempotently and then calls one shared `evaluateGate(record)` function, which is the only place the grant/no-grant decision is made.

A separate `verification_hold_at` / `verification_hold_by` pair models an explicit moderator hold. `evaluateGate` checks the hold before anything else, so a held member cannot be re-verified by any subsequent step completion, and a rejoin does not auto-restore `verified` while a hold is active.

## Consequences

- Step-completion order is irrelevant by construction; no handler needs to know what any other handler has done.
- `evaluateGate` has a small, fully enumerable input space and is trivial to test exhaustively — the regression case (held member with all three steps complete must return `held`, not `grant`) is one test among many rather than a special-cased branch.
- Moderator commands (`verify`, `unverify`, `reset`) mutate the same columns the normal flow uses and go through the same gate function, so they cannot produce a state the normal flow could not also produce.
- The trade-off is a slightly wider table (five nullable timestamp columns plus two hold columns) versus a single status enum — accepted because the columns double as an audit trail (`/onboarding status` reads them directly) and because the enum alternative was structurally unable to handle out-of-order completion.
