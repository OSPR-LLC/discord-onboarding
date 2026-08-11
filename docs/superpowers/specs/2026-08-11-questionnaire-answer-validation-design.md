# Questionnaire Answer Validation — Design

> Extends `docs/superpowers/specs/2026-08-11-configurable-questionnaire-design.md`. Requested directly by the project owner: text-type questions should support "numbers only" and character-limit validation. The originally-requested "year dropdown" use case doesn't need new work — `single_select` with admin-enumerated options already covers it (see Platform constraint below).

## Goal

Today a `text`-type question accepts any string up to a fixed 1000-character modal limit, with no further constraint. This adds two independently-optional validation rules per text question: **numeric-only** (digits only) and a **character limit** (min/max length). Select-type questions (`single_select`/`multi_select`) need no new validation — the option list itself already constrains the answer to one of the admin-defined choices.

## Platform constraint that shaped the scope

Discord select menus cap at 25 options — a hard platform limit, not a configurable one. A "pick your birth year" dropdown spanning multiple decades (70+ options) cannot be built as a native Discord select regardless of implementation. The project owner explicitly chose to keep that constraint as admin responsibility (enumerate ≤25 options — e.g. decade buckets) rather than reinterpreting large ranges as validated numeric text input. So this design adds no new "range" or "dropdown-generation" feature — `/config question add type:single_select options:...` already does everything needed for enumerated choices, today.

## Data model

Additive columns on `questionnaire_questions` (no destructive migration — unlike the Plan 07 questionnaire rework, this is a pure extension of the existing table):

```sql
ALTER TABLE questionnaire_questions ADD COLUMN numeric_only INTEGER NOT NULL DEFAULT 0;
ALTER TABLE questionnaire_questions ADD COLUMN min_length INTEGER;
ALTER TABLE questionnaire_questions ADD COLUMN max_length INTEGER;
```

Guarded in `migrate.ts` the same way the intro-template columns were added: check the column doesn't already exist before running the `ALTER TABLE`, so `migrate()` stays idempotent across repeated runs.

`QuestionDefinition` (in `src/types.ts`) gains:

```ts
readonly numericOnly: boolean
readonly minLength: number | null
readonly maxLength: number | null
```

Present on every question, matching the existing convention that `options` is always present but empty for `text` questions — these three fields are always present but only meaningful when `type === 'text'`.

## Admin configuration commands

`/config question add` and `/config question edit` each gain three new optional parameters:

```
/config question add  prompt:<string> type:<Text|Single-choice|Multiple-choice> required:<bool> options:<…> numeric:<bool> min_length:<int> max_length:<int>
/config question edit position:<int> … numeric:<bool> min_length:<int> max_length:<int>
```

Validation, mirroring the existing text-vs-options guard in `config-question.ts`:

- `numeric`, `min_length`, or `max_length` supplied when `type` (existing or, on edit, the effective post-patch type) isn't `text` → rejected: "Only text questions support numeric/length validation."
- `min_length`/`max_length` outside Discord's allowed modal range (1–4000) → rejected with a clear message.
- `min_length` greater than `max_length` → rejected: "min_length can't be greater than max_length."

These three checks live in the repository layer (`questionnaire-repository.ts`), the same place `too-many-options` is enforced today, returning a new `AddEditError` variant (`invalid-validation`) that the command handler maps to a message — consistent with how `too-many-questions`/`too-many-options`/`not-found` already flow from repo to command.

## Member-facing delivery

**Character limit — enforced natively, no new server-side logic.** `buildQuestionModal` calls `.setMinLength()` / `.setMaxLength()` on the `TextInputBuilder` when the question has them set. Discord's own client blocks submission before the interaction ever reaches the bot — same trust boundary the project already extends to `required`.

**Numeric-only — needs server-side validation**, since Discord's modal text inputs have no "digits only" mode. New pure function in `src/core/questionnaire.ts`:

```ts
isValidNumericAnswer(value: string): boolean   // /^\d+$/ against the trimmed value
```

Kept in `src/core/` (not inline in the Discord adapter) so it's unit-testable and matches the project's layering — the adapter stays thin, validated logic lives in the domain layer, same as `nextUnansweredQuestion`.

On modal submit (`interaction-create.ts`, the `question-modal:` branch): if the question is `numericOnly`, the trimmed answer is non-empty, and `isValidNumericAnswer` returns false, the answer is **not saved** and the flow does **not** advance. Discord does not allow responding to a `ModalSubmitInteraction` with another `showModal` call, so the bot instead replies ephemeral with an error message and a **"Try Again"** button. That button's click (a fresh `ButtonInteraction`) calls `showModal` again as its first response — legal, and the same pattern already used for `rules-agree` advancing straight into a modal.

An empty, non-required numeric answer (member left it blank and it wasn't required) skips numeric validation entirely and saves as `textValue: null`, matching today's optional-question behavior.

New custom id: `CUSTOM_IDS.questionRetry(questionId)` (`onboarding:question-retry:<id>`), parsed the same prefix-matched way as `question-skip`.

Rebuilding the modal on retry needs the full `QuestionDefinition`, not just its id — the repository gains `getQuestionById(guildId, questionId): QuestionDefinition | undefined`, mirroring the existing `getQuestionAtPosition` lookup, used by both the retry handler and the modal-submit validation branch (to know whether the question is `numericOnly` in the first place).

## Error handling

- `/config question add|edit` with an invalid validation combo (wrong type, out-of-range length, min > max) → clear rejection message, same style as existing `/config` errors.
- Modal-submit numeric validation failure → ephemeral error + Try Again button; no answer row written, no advancement. The member can retry indefinitely (no attempt cap — Discord already stops runaway retries at the rate-limit layer, and this project's Hard Rule against ever restricting members applies here too: a stuck validation should never dead-end someone).
- If the question was deleted or edited between the modal being shown and submitted (`getQuestionById` returns nothing, or the question is no longer `numericOnly`), the submit branch falls back to current behavior for that question — no numeric check is applied if the question can no longer be found by id (treated the same as any other "config changed mid-flow" case already accepted in the Plan 07 design).

## Testing

Same TDD pattern as the rest of the project:

- `isValidNumericAnswer` unit tests (digits only passes; letters, symbols, decimals, empty string fail; leading/trailing whitespace trimmed before checking).
- Repository tests: `addQuestion`/`editQuestion` accept valid validation fields on `text` questions, reject them on `select` questions, reject out-of-range lengths, reject `min_length > max_length`, round-trip persisted values through `listQuestions`.
- `migrate.ts` test: new columns exist after migration, default `numeric_only` to `0`/false, idempotent on repeated `migrate()` calls.
- Component-builder test: `buildQuestionModal` applies `setMinLength`/`setMaxLength` when present, omits them when null.
- `config-question.ts` command tests for the new parameter validation paths (mirroring the existing text-vs-options test coverage).
- `interaction-create.ts`'s `question-modal:`/`question-retry:` branches get no dedicated test file, matching the pre-existing convention for that file (Plan 07's ledger already established this — meaningful logic lives in `isValidNumericAnswer`, which is unit tested).

## Out of scope

- Any new validation type beyond numeric-only and character limit (e.g. regex patterns, email format, min/max *numeric value* rather than length) — not requested, not built.
- Reinterpreting large enumerated ranges (years, etc.) as validated numeric text input — explicitly declined in favor of keeping admin-enumerated `single_select` as the only "dropdown" mechanism.
- A retry attempt cap or cooldown on the numeric validation failure path — not requested, and would risk conflicting with the project's Hard Rule that reminders/restrictions never lock a member out.
