import { describe, expect, it } from 'vitest'
import { createTaskQueue } from '../../src/core/task-queue.js'
import { createQueuedPort } from '../../src/discord/queued-port.js'
import { createFakeDiscordPort } from '../helpers/fake-discord-port.js'

describe('createQueuedPort', () => {
	it('passes calls through to the inner port', async () => {
		const fake = createFakeDiscordPort()
		const queue = createTaskQueue({ concurrency: 4, maxQueued: 100 })
		const port = createQueuedPort(fake.port, queue, 'interactive')

		await port.addRole('g1', 'u1', 'r1')

		expect(fake.addedRoles).toContainEqual({ guildId: 'g1', userId: 'u1', roleId: 'r1' })
	})

	it('returns the inner port result unchanged', async () => {
		const fake = createFakeDiscordPort()
		fake.failRoleFor('u2')
		const queue = createTaskQueue({ concurrency: 4, maxQueued: 100 })
		const port = createQueuedPort(fake.port, queue, 'interactive')

		const result = await port.addRole('g1', 'u2', 'r1')

		expect(result.ok).toBe(false)
	})

	it('serialises calls to the configured concurrency', async () => {
		const fake = createFakeDiscordPort()
		const queue = createTaskQueue({ concurrency: 1, maxQueued: 100 })
		const port = createQueuedPort(fake.port, queue, 'bulk')

		await Promise.all([
			port.addRole('g1', 'a', 'r'),
			port.addRole('g1', 'b', 'r'),
			port.addRole('g1', 'c', 'r')
		])

		expect(fake.addedRoles).toHaveLength(3)
	})

	it('surfaces a full queue as a failed Result rather than throwing at the caller', async () => {
		const fake = createFakeDiscordPort()
		const queue = createTaskQueue({ concurrency: 1, maxQueued: 0 })
		const port = createQueuedPort(fake.port, queue, 'bulk')

		const results = await Promise.all([port.addRole('g1', 'a', 'r'), port.addRole('g1', 'b', 'r')])

		expect(results.some((result) => !result.ok)).toBe(true)
	})
})
