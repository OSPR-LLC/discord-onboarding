import type { Database, Statement } from 'better-sqlite3'
import type {
	ExperienceLevel,
	OnboardingRecord,
	OnboardingStep,
	QuestionnaireAnswers
} from '../types.js'

type OnboardingRow = {
	guild_id: string
	user_id: string
	first_joined_at: string
	last_joined_at: string
	rules_accepted_at: string | null
	questionnaire_completed_at: string | null
	intro_posted_at: string | null
	intro_message_id: string | null
	verified_at: string | null
	verification_hold_at: string | null
	verification_hold_by: string | null
	reminders_sent: number
	last_reminder_at: string | null
}

type AnswerRow = {
	guild_id: string
	user_id: string
	purpose: string | null
	experience_level: string | null
	built_for_discord: number | null
	answered_at: string | null
}

export type AnswerPatch = {
	purpose?: string
	experienceLevel?: ExperienceLevel
	builtForDiscord?: boolean
}

const STEP_COLUMNS: Record<OnboardingStep, string> = {
	rules: 'rules_accepted_at',
	questionnaire: 'questionnaire_completed_at',
	intro: 'intro_posted_at'
}

const toRecord = (row: OnboardingRow): OnboardingRecord => ({
	guildId: row.guild_id,
	userId: row.user_id,
	firstJoinedAt: row.first_joined_at,
	lastJoinedAt: row.last_joined_at,
	rulesAcceptedAt: row.rules_accepted_at,
	questionnaireCompletedAt: row.questionnaire_completed_at,
	introPostedAt: row.intro_posted_at,
	introMessageId: row.intro_message_id,
	verifiedAt: row.verified_at,
	verificationHoldAt: row.verification_hold_at,
	verificationHoldBy: row.verification_hold_by,
	remindersSent: row.reminders_sent,
	lastReminderAt: row.last_reminder_at
})

const toAnswers = (row: AnswerRow): QuestionnaireAnswers => ({
	guildId: row.guild_id,
	userId: row.user_id,
	purpose: row.purpose,
	experienceLevel: row.experience_level as ExperienceLevel | null,
	builtForDiscord: row.built_for_discord === null ? null : row.built_for_discord === 1,
	answeredAt: row.answered_at
})

export const createOnboardingRepository = (db: Database) => {
	// Compiled once at construction. These run on every gateway event in every
	// served guild, so per-call compilation would be the hottest waste in the
	// process.
	const statements = {
		get: db.prepare('SELECT * FROM onboarding WHERE guild_id = ? AND user_id = ?'),
		getAnswers: db.prepare(
			'SELECT * FROM questionnaire_answers WHERE guild_id = ? AND user_id = ?'
		),
		upsertOnJoin: db.prepare(
			`INSERT INTO onboarding (guild_id, user_id, first_joined_at, last_joined_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(guild_id, user_id) DO UPDATE SET last_joined_at = excluded.last_joined_at`
		),
		setIntroMessageId: db.prepare(
			'UPDATE onboarding SET intro_message_id = COALESCE(intro_message_id, ?) WHERE guild_id = ? AND user_id = ?'
		),
		markVerified: db.prepare(
			'UPDATE onboarding SET verified_at = COALESCE(verified_at, ?) WHERE guild_id = ? AND user_id = ?'
		),
		setHold: db.prepare(
			'UPDATE onboarding SET verification_hold_at = ?, verification_hold_by = ?, verified_at = NULL WHERE guild_id = ? AND user_id = ?'
		),
		clearHold: db.prepare(
			'UPDATE onboarding SET verification_hold_at = NULL, verification_hold_by = NULL WHERE guild_id = ? AND user_id = ?'
		),
		deleteAnswers: db.prepare(
			'DELETE FROM questionnaire_answers WHERE guild_id = ? AND user_id = ?'
		),
		deleteRecord: db.prepare('DELETE FROM onboarding WHERE guild_id = ? AND user_id = ?'),
		insertAnswers: db.prepare(
			'INSERT INTO questionnaire_answers (guild_id, user_id) VALUES (?, ?) ON CONFLICT(guild_id, user_id) DO NOTHING'
		),
		setPurpose: db.prepare(
			'UPDATE questionnaire_answers SET purpose = ? WHERE guild_id = ? AND user_id = ?'
		),
		setExperience: db.prepare(
			'UPDATE questionnaire_answers SET experience_level = ? WHERE guild_id = ? AND user_id = ?'
		),
		setBuilt: db.prepare(
			'UPDATE questionnaire_answers SET built_for_discord = ? WHERE guild_id = ? AND user_id = ?'
		),
		stampAnsweredAt: db.prepare(
			'UPDATE questionnaire_answers SET answered_at = COALESCE(answered_at, ?) WHERE guild_id = ? AND user_id = ?'
		),
		stampQuestionnaireComplete: db.prepare(
			'UPDATE onboarding SET questionnaire_completed_at = COALESCE(questionnaire_completed_at, ?) WHERE guild_id = ? AND user_id = ?'
		),
		incrementReminder: db.prepare(
			'UPDATE onboarding SET reminders_sent = reminders_sent + 1, last_reminder_at = ? WHERE guild_id = ? AND user_id = ?'
		),
		// The elapsed-time comparison is pushed into SQL so a guild with a large
		// backlog does not deserialise every pending row just to discard most of
		// them in JavaScript. The idx_onboarding_pending index covers this.
		listAwaitingReminder: db.prepare(
			`SELECT * FROM onboarding
			 WHERE guild_id = ?
			   AND verified_at IS NULL
			   AND verification_hold_at IS NULL
			   AND reminders_sent < 2
			   AND (
			     (reminders_sent = 0 AND (? - CAST(strftime('%s', last_joined_at) AS INTEGER) * 1000) >= ?)
			     OR
			     (reminders_sent = 1 AND (? - CAST(strftime('%s', last_joined_at) AS INTEGER) * 1000) >= ?)
			   )
			 LIMIT ?`
		)
	}

	// See the equivalent map in guild-config-repository.ts (Task 5) for why this is
	// Statement<[...]> and not ReturnType<Database['prepare']>.
	const stepStatements = Object.fromEntries(
		Object.entries(STEP_COLUMNS).map(([step, column]) => [
			step,
			db.prepare(
				`UPDATE onboarding SET ${column} = COALESCE(${column}, ?) WHERE guild_id = ? AND user_id = ?`
			)
		])
	) as Record<OnboardingStep, Statement<[string, string, string]>>

	const get = (guildId: string, userId: string): OnboardingRecord | null => {
		const row = statements.get.get(guildId, userId) as OnboardingRow | undefined
		return row ? toRecord(row) : null
	}

	const getAnswers = (guildId: string, userId: string): QuestionnaireAnswers | null => {
		const row = statements.getAnswers.get(guildId, userId) as AnswerRow | undefined
		return row ? toAnswers(row) : null
	}

	const upsertOnJoin = (guildId: string, userId: string, at: string): void => {
		statements.upsertOnJoin.run(guildId, userId, at, at)
	}

	// Transactions are built once. better-sqlite3 compiles the wrapper on
	// creation, so rebuilding it per call would defeat the point.
	const removeTx = db.transaction((guildId: string, userId: string) => {
		statements.deleteAnswers.run(guildId, userId)
		statements.deleteRecord.run(guildId, userId)
	})

	const saveAnswerTx = db.transaction(
		(guildId: string, userId: string, patch: AnswerPatch, at: string) => {
			// The member must have a record before answers can reference it.
			upsertOnJoin(guildId, userId, at)
			statements.insertAnswers.run(guildId, userId)

			if (patch.purpose !== undefined) statements.setPurpose.run(patch.purpose, guildId, userId)
			if (patch.experienceLevel !== undefined)
				statements.setExperience.run(patch.experienceLevel, guildId, userId)
			if (patch.builtForDiscord !== undefined)
				statements.setBuilt.run(patch.builtForDiscord ? 1 : 0, guildId, userId)

			const row = statements.getAnswers.get(guildId, userId) as AnswerRow

			const complete =
				row.purpose !== null && row.experience_level !== null && row.built_for_discord !== null

			if (complete) {
				statements.stampAnsweredAt.run(at, guildId, userId)
				statements.stampQuestionnaireComplete.run(at, guildId, userId)
			}
		}
	)

	return {
		get,
		getAnswers,
		upsertOnJoin,

		stampStep: (guildId: string, userId: string, step: OnboardingStep, at: string): void => {
			stepStatements[step].run(at, guildId, userId)
		},

		setIntroMessageId: (guildId: string, userId: string, messageId: string): void => {
			statements.setIntroMessageId.run(messageId, guildId, userId)
		},

		markVerified: (guildId: string, userId: string, at: string): void => {
			statements.markVerified.run(at, guildId, userId)
		},

		setHold: (guildId: string, userId: string, at: string, byUserId: string): void => {
			statements.setHold.run(at, byUserId, guildId, userId)
		},

		clearHold: (guildId: string, userId: string): void => {
			statements.clearHold.run(guildId, userId)
		},

		remove: (guildId: string, userId: string): void => {
			removeTx(guildId, userId)
		},

		saveAnswer: (guildId: string, userId: string, patch: AnswerPatch, at: string): void => {
			saveAnswerTx(guildId, userId, patch, at)
		},

		listAwaitingReminder: (
			guildId: string,
			nowMs: number,
			firstAfterMs: number,
			secondAfterMs: number,
			limit = 500
		): OnboardingRecord[] =>
			(
				statements.listAwaitingReminder.all(
					guildId,
					nowMs,
					firstAfterMs,
					nowMs,
					secondAfterMs,
					limit
				) as OnboardingRow[]
			).map(toRecord),

		incrementReminder: (guildId: string, userId: string, at: string): void => {
			statements.incrementReminder.run(at, guildId, userId)
		}
	}
}

export type OnboardingRepository = ReturnType<typeof createOnboardingRepository>
