export type Result<T, E> =
	{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })
export const isOk = <T, E>(result: Result<T, E>): result is Extract<Result<T, E>, { ok: true }> =>
	result.ok

export const EXPERIENCE_LEVELS = {
	NEW: 'new-to-everything',
	SOME: 'a-little-experience',
	WRITES: 'writes-software',
	ADVANCED: 'advanced'
} as const

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[keyof typeof EXPERIENCE_LEVELS]

export type OnboardingStep = 'rules' | 'questionnaire' | 'intro'

export type OnboardingRecord = {
	readonly guildId: string
	readonly userId: string
	readonly firstJoinedAt: string
	readonly lastJoinedAt: string
	readonly rulesAcceptedAt: string | null
	readonly questionnaireCompletedAt: string | null
	readonly introPostedAt: string | null
	readonly introMessageId: string | null
	readonly verifiedAt: string | null
	readonly verificationHoldAt: string | null
	readonly verificationHoldBy: string | null
	readonly remindersSent: number
	readonly lastReminderAt: string | null
}

export type QuestionnaireAnswers = {
	readonly guildId: string
	readonly userId: string
	readonly purpose: string | null
	readonly experienceLevel: ExperienceLevel | null
	readonly builtForDiscord: boolean | null
	readonly answeredAt: string | null
}

export type GuildConfigRow = {
	readonly guildId: string
	readonly rulesChannelId: string | null
	readonly introductionsChannelId: string | null
	readonly modLogChannelId: string | null
	readonly verifiedRoleId: string | null
	readonly unverifiedRoleId: string | null
	readonly rulesText: string | null
	readonly rulesMessageId: string | null
	readonly enabled: boolean
	readonly grandfatherBefore: string | null
	readonly joinedAt: string
	readonly configuredAt: string | null
	readonly configuredBy: string | null
}
