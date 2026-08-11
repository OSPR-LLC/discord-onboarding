# Configurable Questionnaire — Design

> Revises the questionnaire step of `docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md`. Requested directly by the project owner: admins should be able to define their own onboarding questions per server instead of the three hardcoded ones.

## Goal

Today the questionnaire is three fixed questions (purpose, experience level, built-for-Discord), each hard-wired to its own Discord component type and its own column in `questionnaire_answers`. This replaces that with a per-guild, admin-configurable question set: any number of questions (up to a cap), each either free-text or a select (single- or multi-choice), each independently marked required or optional, in an admin-defined order.

## Platform constraint that shapes the whole design

Discord modals can only contain text-input fields — never select menus, buttons, or checkboxes. A question configured as "options" cannot be delivered inside a modal; it has to be a select-menu component sent as a separate (ephemeral) step, exactly like today's experience-level dropdown already is. Text questions use a modal, select questions don't — that split is a platform fact, not a design choice.

## Data model

Replaces the fixed-column `questionnaire_answers` table with three normalized tables:

```sql
CREATE TABLE questionnaire_questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  position    INTEGER NOT NULL,
  prompt      TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('text','single_select','multi_select')),
  required    INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE questionnaire_question_options (
  question_id INTEGER NOT NULL REFERENCES questionnaire_questions(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  label       TEXT NOT NULL,
  value       TEXT NOT NULL,
  PRIMARY KEY (question_id, position)
);

CREATE TABLE questionnaire_answers (
  guild_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  question_id     INTEGER NOT NULL REFERENCES questionnaire_questions(id) ON DELETE CASCADE,
  text_value      TEXT,
  selected_values TEXT,  -- JSON array of option values; set for select types
  answered_at     TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id, question_id),
  FOREIGN KEY (guild_id, user_id) REFERENCES onboarding(guild_id, user_id) ON DELETE CASCADE
);
```

**Destructive migration, deliberately accepted.** The old `questionnaire_answers` has a different shape entirely (fixed `purpose`/`experience_level`/`built_for_discord` columns) — this can't be an additive `ALTER TABLE` like the Plan 06 migration. `migrate.ts` drops and recreates that one table when it detects the old shape (presence of a `purpose` column), discarding any existing rows. Accepted because no guild has live production answer data yet.

**Caps**, enforced in the admin commands (not just the DB): 10 questions per guild, 25 options per question. 25 is also Discord's hard platform limit for select-menu options.

An "answer" row means *resolved*, not *non-empty* — an optional question the member skips still gets a row (`text_value: null` or `selected_values: '[]'`), so downstream "which question is next" logic only has to check "does a row exist for this question id," never re-derive required-ness.

## Admin configuration commands

Slash-command options do the type/required selection natively (a real dropdown, a real boolean) rather than parsing free text out of a modal — only the select-type option list needs a modal-free comma-separated string:

```
/config question add    prompt:<string> type:<Text|Single-choice|Multiple-choice> required:<bool> options:<comma-separated, only for select types>
/config question edit   position:<int> prompt:… type:… required:… options:…   (all optional — only supplied fields change)
/config question remove position:<int>
/config question move   position:<int> to:<int>
/config question list                                                          (shows current ordered set, 1-based positions)
/config question clear                                                        (removes all questions)
```

`position` is the 1-based index shown by `/config question list` — friendlier to type than the internal DB `id`; internally, `questionnaire_questions.position` and `questionnaire_question_options.position` are stored 0-based and translated at the command boundary. Comma-separated option labels are slugified into stable `value`s (`"New to everything"` → `new-to-everything`) for storage and for select-menu option values; a duplicate slug within the same question gets a numeric suffix (`new-to-everything-2`) to stay unique.

`options` is required when `type` is `single_select`/`multi_select` and rejected (with a clear error) when `type` is `text` — the two are mutually exclusive, never optional-but-ignored.

A guild with **zero configured questions** is valid and intentional: the questionnaire step is treated as immediately complete, and onboarding goes straight from rules acceptance to the introduction-post step. New/existing guilds start with zero questions (no seeded defaults) — an admin who wants the old three-question set recreates it with `/config question add`.

## Member-facing delivery

One question per interaction step, matching today's flow — no batching several text questions into a single multi-field modal. Keeps the code and the state machine simple, and stays consistent with the existing one-step-per-question pattern.

- `type: text` → a `ModalBuilder` with one `TextInputBuilder` (Paragraph style). `setRequired()` mirrors the question's `required` flag; Discord natively allows blank submission when not required.
- `type: single_select` / `multi_select` → a `StringSelectMenuBuilder` (`maxValues` = 1 for single, up to the option count for multi) sent as an ephemeral component. If not required, `minValues(0)` plus a secondary "Skip" button next to it — a select menu alone can't be submitted empty, since selecting a value *is* the submission.

Custom IDs become dynamic — `questionnaire:question:<questionId>` for the select/skip components, `questionnaire:question-modal:<questionId>` for the text modal — replacing the current fixed `CUSTOM_IDS.purposeModal` / `experienceSelect` / `builtYes`/`builtNo` constants. `interaction-create.ts` routing for this one family switches from exact-match lookup to a prefix parse (`questionnaire:question:` / `questionnaire:question-modal:` + numeric id).

## Domain layer

New `src/core/questionnaire.ts` replaces the hardcoded `'purpose' | 'experience' | 'built' | 'done'` union and `nextQuestion` function:

```ts
type QuestionType = 'text' | 'single_select' | 'multi_select'

type QuestionOption = { position: number; label: string; value: string }

type QuestionDefinition = {
  id: number
  position: number
  prompt: string
  type: QuestionType
  required: boolean
  options: QuestionOption[]
}

type QuestionAnswer = {
  questionId: number
  textValue: string | null
  selectedValues: string[]
}

nextUnansweredQuestion(
  questions: QuestionDefinition[],
  answers: QuestionAnswer[]
): QuestionDefinition | null
```

`src/core/` continues to accept only fully-resolved data (an ordered `QuestionDefinition[]` plus the member's `QuestionAnswer[]`) — never loose guild ids, matching the project's existing layering rule. Required-vs-optional enforcement lives entirely at the Discord/UI boundary (whether a modal field is required, whether a Skip button exists); the domain layer only asks "is there an answer row for this question id yet."

`promptNextQuestion` (in `src/discord/commands/intro.ts`) changes from switching on a fixed union to calling `nextUnansweredQuestion` and building whichever component (modal vs. select+skip) that question's `type` calls for. Re-entry via `/intro` keeps working unchanged in spirit — it already re-derives from current answers each time; it just now re-derives against a dynamic list instead of three fixed fields.

## Error handling

- `/config question add|edit` reject over the 10-question / 25-option caps with a clear message, same pattern as existing `/config` validation errors.
- `/config question move|edit|remove` with an out-of-range `position` reports "no question at position N" rather than a raw DB error.
- A guild's question list can shrink or reorder while a member is mid-flow (per the "always use current config" decision below) — this needs no special handling since `nextUnansweredQuestion` just re-evaluates against whatever the current list is on every call.

## Config-change-while-in-flight behavior

If an admin edits the question set while a member is partway through, the member's remaining questions follow the new config live — `nextUnansweredQuestion` always re-reads current config, no snapshotting. Matches how `/config rules-text` and `/config intro-template` already behave (edit-in-place, no versioning). If a question a member already answered gets removed, its answer row is cascade-deleted with it (`ON DELETE CASCADE`) — harmless, since "next unanswered" simply won't see a question that no longer exists.

## Testing

Same TDD pattern as the rest of the project:
- Unit tests for `nextUnansweredQuestion` (empty list → `null`, required question blocks advancement, optional question with a skip-row counts as answered, order respected).
- Repository tests for question CRUD (add/edit/remove/move/list, cap enforcement, cascade delete of options and answers).
- Component-builder tests for dynamic modal/select construction (required vs. optional rendering, single vs. multi select `maxValues`).
- Typecheck across the new dynamic custom-id parsing in `interaction-create.ts`.

## Out of scope

- Conditional/branching questions (question 2 depends on question 1's answer) — not requested, not built.
- Editing an in-progress member's *own* answers after submission (re-answering) — out of scope; `/onboarding reset` already exists for a full restart.
- Migrating old answer data forward — explicitly accepted as a destructive migration above.
