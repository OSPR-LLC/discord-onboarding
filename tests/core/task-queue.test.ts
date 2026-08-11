import { describe, expect, it, vi } from 'vitest'
import { createTaskQueue } from '../../src/core/task-queue.js'

const deferred = <T>() => {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((r) => {
		resolve = r
	})
	return { promise, resolve }
}

describe('createTaskQueue', () => {
	it('runs a task and returns its value', async () => {
		const queue = createTaskQueue({ concurrency: 1, maxQueued: 10 })
		await expect(queue.run('interactive', async () => 42)).resolves.toBe(42)
	})

	it('propagates a task failure to its caller', async () => {
		const queue = createTaskQueue({ concurrency: 1, maxQueued: 10 })
		await expect(
			queue.run('interactive', async () => {
				throw new Error('boom')
			})
		).rejects.toThrow('boom')
	})

	it('never runs more than the configured concurrency at once', async () => {
		const queue = createTaskQueue({ concurrency: 2, maxQueued: 100 })
		let running = 0
		let peak = 0
		const gate = deferred<void>()

		const tasks = Array.from({ length: 10 }, () =>
			queue.run('bulk', async () => {
				running += 1
				peak = Math.max(peak, running)
				await gate.promise
				running -= 1
			})
		)

		await Promise.resolve()
		gate.resolve()
		await Promise.all(tasks)

		expect(peak).toBe(2)
	})

	it('runs interactive work before bulk work already queued', async () => {
		const queue = createTaskQueue({ concurrency: 1, maxQueued: 100 })
		const order: string[] = []
		const gate = deferred<void>()

		// Occupy the single slot so everything else must queue.
		const blocker = queue.run('bulk', async () => {
			await gate.promise
		})

		const queued = [
			queue.run('bulk', async () => void order.push('bulk-1')),
			queue.run('bulk', async () => void order.push('bulk-2')),
			queue.run('interactive', async () => void order.push('interactive'))
		]

		gate.resolve()
		await Promise.all([blocker, ...queued])

		expect(order[0]).toBe('interactive')
	})

	it('rejects new bulk work once the queue is full rather than growing without bound', async () => {
		const queue = createTaskQueue({ concurrency: 1, maxQueued: 2 })
		const gate = deferred<void>()

		const blocker = queue.run('bulk', async () => {
			await gate.promise
		})
		const queued = [
			queue.run('bulk', async () => undefined),
			queue.run('bulk', async () => undefined)
		]

		await expect(queue.run('bulk', async () => undefined)).rejects.toThrow(/queue is full/i)

		gate.resolve()
		await Promise.all([blocker, ...queued])
	})

	it('still accepts interactive work when the bulk queue is full', async () => {
		const queue = createTaskQueue({ concurrency: 1, maxQueued: 2 })
		const gate = deferred<void>()

		const blocker = queue.run('bulk', async () => {
			await gate.promise
		})
		const queued = [
			queue.run('bulk', async () => undefined),
			queue.run('bulk', async () => undefined)
		]

		const interactive = queue.run('interactive', async () => 'ok')

		gate.resolve()
		await expect(interactive).resolves.toBe('ok')
		await Promise.all([blocker, ...queued])
	})

	it('reports queue depth per priority', async () => {
		const queue = createTaskQueue({ concurrency: 1, maxQueued: 100 })
		const gate = deferred<void>()

		const blocker = queue.run('bulk', async () => {
			await gate.promise
		})
		const queued = [
			queue.run('bulk', async () => undefined),
			queue.run('interactive', async () => undefined)
		]

		expect(queue.size('bulk')).toBe(1)
		expect(queue.size('interactive')).toBe(1)
		expect(queue.pending()).toBe(1)

		gate.resolve()
		await Promise.all([blocker, ...queued])
		expect(queue.size('bulk')).toBe(0)
	})

	it('keeps draining after a task rejects', async () => {
		const queue = createTaskQueue({ concurrency: 1, maxQueued: 10 })

		const failing = queue.run('bulk', async () => {
			throw new Error('boom')
		})
		const following = queue.run('bulk', async () => 'survived')

		await expect(failing).rejects.toThrow('boom')
		await expect(following).resolves.toBe('survived')
	})
})
