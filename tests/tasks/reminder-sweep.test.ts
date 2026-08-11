import { beforeEach, describe, expect, it } from 'vitest'
import type { ResolvedGuildConfig } from '../../src/core/guild-config.js'
import { createOnboardingRepository } from '../../src/db/onboarding-repository.js'
import { runGuildReminderSweep } from '../../src/tasks/reminder-sweep.js'
import { createFakeDiscordPort } from '../helpers/fake-discord-port.js'
import { createTestDb } from '../helpers/test-db.js'

const GUILD = '123456789012345678'
const USER = '223456789012345678'
const JOINED = '2026-08-10T10:00:00.000Z'
const HOUR = 60 * 60 * 1000

const config: ResolvedGuildConfig = {
	guildId: GUILD,
	rulesChannelId: '1',
	introductionsChannelId: '2',
	modLogChannelId: '3',
	verifiedRoleId: '4',
	unverifiedRoleId: '5',
	rulesText: 'rules',
	rulesMessageId: null,
	grandfatherBefore: null
}

const hoursAfterJoin = (hours: number) => new Date(Date.parse(JOINED) + hours * HOUR)

let repo: ReturnType<typeof createOnboardingRepository>
let fake: ReturnType<typeof createFakeDiscordPort>
let clock: Date

const sweep = () => runGuildReminderSweep({ repo, port: fake.port, now: () => clock }, config)

beforeEach(() => {
	repo = createOnboardingRepository(createTestDb())
	fake = createFakeDiscordPort()
	repo.upsertOnJoin(GUILD, USER, JOINED)
	clock = hoursAfterJoin(0)
})

describe('runGuildReminderSweep', () => {
	it('sends nothing before the first threshold', async () => {
		clock = hoursAfterJoin(23)
		expect(await sweep()).toBe(0)
		expect(fake.dms).toHaveLength(0)
	})

	it('sends the first reminder once 24 hours have elapsed', async () => {
		clock = hoursAfterJoin(24)
		expect(await sweep()).toBe(1)
		expect(repo.get(GUILD, USER)?.remindersSent).toBe(1)
	})

	it('does not send a second reminder before 72 hours', async () => {
		clock = hoursAfterJoin(24)
		await sweep()
		clock = hoursAfterJoin(48)
		expect(await sweep()).toBe(0)
	})

	it('sends the second reminder once 72 hours have elapsed', async () => {
		clock = hoursAfterJoin(24)
		await sweep()
		clock = hoursAfterJoin(72)
		expect(await sweep()).toBe(1)
		expect(repo.get(GUILD, USER)?.remindersSent).toBe(2)
	})

	it('stops permanently after the second reminder', async () => {
		clock = hoursAfterJoin(24)
		await sweep()
		clock = hoursAfterJoin(72)
		await sweep()
		clock = hoursAfterJoin(500)
		expect(await sweep()).toBe(0)
	})

	it('never contacts a verified member', async () => {
		repo.markVerified(GUILD, USER, JOINED)
		clock = hoursAfterJoin(24)
		expect(await sweep()).toBe(0)
	})

	it('never contacts a held member', async () => {
		repo.setHold(GUILD, USER, JOINED, 'mod')
		clock = hoursAfterJoin(24)
		expect(await sweep()).toBe(0)
	})

	it('counts a reminder as sent even when the member has DMs closed', async () => {
		fake.failDmFor(USER)
		clock = hoursAfterJoin(24)
		await sweep()
		expect(repo.get(GUILD, USER)?.remindersSent).toBe(1)
	})

	it('names only the steps the member still has outstanding', async () => {
		repo.stampStep(GUILD, USER, 'rules', JOINED)
		clock = hoursAfterJoin(24)
		await sweep()

		const body = fake.dms[0]?.content.body ?? ''
		expect(body).not.toMatch(/agree to the rules/i)
		expect(body).toMatch(/questionnaire/i)
		expect(body).toMatch(/introduce/i)
	})

	it('advances the counter for a member with nothing outstanding rather than reselecting them forever', async () => {
		for (const step of ['rules', 'questionnaire', 'intro'] as const)
			repo.stampStep(GUILD, USER, step, JOINED)

		clock = hoursAfterJoin(24)
		await sweep()

		expect(fake.dms).toHaveLength(0)
		expect(repo.get(GUILD, USER)?.remindersSent).toBe(1)
	})

	it('does not touch members belonging to another guild', async () => {
		const otherGuild = '923456789012345678'
		repo.upsertOnJoin(otherGuild, USER, JOINED)
		clock = hoursAfterJoin(24)

		await sweep()

		expect(repo.get(otherGuild, USER)?.remindersSent).toBe(0)
	})
})
