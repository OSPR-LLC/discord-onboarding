CREATE TABLE IF NOT EXISTS guild_config (
	guild_id                   TEXT PRIMARY KEY,
	rules_channel_id           TEXT,
	introductions_channel_id   TEXT,
	mod_log_channel_id         TEXT,
	verified_role_id           TEXT,
	unverified_role_id         TEXT,
	rules_text                 TEXT,
	rules_message_id           TEXT,
	intro_template_text        TEXT,
	intro_template_message_id  TEXT,
	enabled                    INTEGER NOT NULL DEFAULT 0,
	grandfather_before         TEXT,
	joined_at                  TEXT NOT NULL,
	configured_at              TEXT,
	configured_by              TEXT
);

CREATE TABLE IF NOT EXISTS onboarding (
	guild_id                   TEXT NOT NULL,
	user_id                    TEXT NOT NULL,
	first_joined_at            TEXT NOT NULL,
	last_joined_at             TEXT NOT NULL,
	rules_accepted_at          TEXT,
	questionnaire_completed_at TEXT,
	intro_posted_at            TEXT,
	intro_message_id           TEXT,
	verified_at                TEXT,
	verification_hold_at       TEXT,
	verification_hold_by       TEXT,
	reminders_sent             INTEGER NOT NULL DEFAULT 0,
	last_reminder_at           TEXT,
	PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS questionnaire_questions (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	guild_id    TEXT NOT NULL,
	position    INTEGER NOT NULL,
	prompt      TEXT NOT NULL,
	type        TEXT NOT NULL CHECK (type IN ('text','single_select','multi_select')),
	required    INTEGER NOT NULL DEFAULT 1,
	created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_questionnaire_questions_guild
	ON questionnaire_questions (guild_id, position);

CREATE TABLE IF NOT EXISTS questionnaire_question_options (
	question_id INTEGER NOT NULL REFERENCES questionnaire_questions(id) ON DELETE CASCADE,
	position    INTEGER NOT NULL,
	label       TEXT NOT NULL,
	value       TEXT NOT NULL,
	PRIMARY KEY (question_id, position)
);

CREATE TABLE IF NOT EXISTS questionnaire_answers (
	guild_id        TEXT NOT NULL,
	user_id         TEXT NOT NULL,
	question_id     INTEGER NOT NULL REFERENCES questionnaire_questions(id) ON DELETE CASCADE,
	text_value      TEXT,
	selected_values TEXT,
	answered_at     TEXT NOT NULL,
	PRIMARY KEY (guild_id, user_id, question_id),
	FOREIGN KEY (guild_id, user_id) REFERENCES onboarding(guild_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_onboarding_pending
	ON onboarding (guild_id, verified_at, verification_hold_at, reminders_sent, last_joined_at);
