export type Priority = 'interactive' | 'bulk'

export type TaskQueueOptions = {
	/** Maximum tasks executing at once. */
	readonly concurrency: number
	/** Maximum tasks waiting per priority before new bulk work is rejected. */
	readonly maxQueued: number
}

type Entry = {
	readonly run: () => Promise<void>
}

export type TaskQueue = {
	run: <T>(priority: Priority, fn: () => Promise<T>) => Promise<T>
	size: (priority: Priority) => number
	pending: () => number
	drain: () => Promise<void>
}

export class QueueFullError extends Error {
	constructor() {
		super('Task queue is full — refusing more bulk work')
		this.name = 'QueueFullError'
	}
}

export const createTaskQueue = (options: TaskQueueOptions): TaskQueue => {
	// Two plain arrays rather than a heap: with exactly two priorities, checking
	// interactive first is the whole scheduling algorithm.
	const queues: Record<Priority, Entry[]> = { interactive: [], bulk: [] }

	let active = 0
	let idleWaiters: (() => void)[] = []

	const next = (): Entry | undefined => queues.interactive.shift() ?? queues.bulk.shift()

	const pump = (): void => {
		while (active < options.concurrency) {
			const entry = next()
			if (!entry) break

			active += 1
			void entry.run().finally(() => {
				active -= 1
				pump()

				if (active === 0 && queues.interactive.length === 0 && queues.bulk.length === 0) {
					const waiters = idleWaiters
					idleWaiters = []
					for (const resolve of waiters) resolve()
				}
			})
		}
	}

	return {
		run: <T>(priority: Priority, fn: () => Promise<T>): Promise<T> => {
			// Interactive work is never rejected. It is bounded in practice by
			// Discord's own gateway rate, and dropping a member's button click to
			// protect a backfill would be exactly the wrong trade.
			if (priority === 'bulk' && queues.bulk.length >= options.maxQueued)
				return Promise.reject(new QueueFullError())

			return new Promise<T>((resolve, reject) => {
				queues[priority].push({
					run: async () => {
						try {
							resolve(await fn())
						} catch (error) {
							reject(error instanceof Error ? error : new Error(String(error)))
						}
					}
				})
				pump()
			})
		},

		size: (priority: Priority): number => queues[priority].length,
		pending: (): number => active,

		drain: (): Promise<void> => {
			if (active === 0 && queues.interactive.length === 0 && queues.bulk.length === 0)
				return Promise.resolve()
			return new Promise((resolve) => idleWaiters.push(resolve))
		}
	}
}
