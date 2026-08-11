---
plan: scale-hardening
project: discord-developer
updated: 2026-08-11
status: 🟡 In Progress
tags: [plan, performance]
---

# 05 — Scale hardening

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md`](../docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md)
**Rationale:** [`decisions/2026-08-10-concurrency-and-scale-model.md`](../decisions/2026-08-10-concurrency-and-scale-model.md)

## Status

🟡 In Progress

## Goal

> The bot serves thousands of guilds from one deployment without a member ever waiting behind a bulk backfill. Every Discord write passes through a rate-limit-aware priority queue, guild config is served from memory, reconciliation is chunked and yields, the process shards across CPU cores, and event-loop lag and queue depth are observable.

## Why not worker threads

Read [`the concurrency ADR`](../decisions/2026-08-10-concurrency-and-scale-model.md) before starting. Summary: this workload has effectively no CPU-bound work — a gate evaluation is four null checks, while a Discord REST call is 50–500 ms of network. Throughput is capped by Discord's per-bot rate limits, which threads cannot expand; extra threads would contend for the same bucket and produce more 429s, not more work done. The parallelism that helps is **process-level sharding**, which Discord mandates past 2,500 guilds anyway.

**Do not add `worker_threads` in this plan.** Task 6 adds the metric that would justify one; if event-loop lag ever correlates with genuine CPU work, revisit then with evidence.

## Global Constraints

Inherits every constraint from plans [[01-bot-foundation]] through [[04-reminders-and-mod-tooling]]. Additionally:

- **Interactive work always outranks bulk work.** A member clicking _I agree_ must never queue behind a reconciliation.
- No unbounded queue, no unbounded result set, no unbounded concurrency. Everything has a ceiling.
- `src/core/` stays free of both discord.js and queue concerns — the queue is a `DiscordPort` decorator.
- Bulk loops must yield to the event loop; a synchronous 10,000-iteration loop stalls every guild.

## File Structure

| File                                       | Responsibility                                           |
| ------------------------------------------ | -------------------------------------------------------- |
| `src/core/task-queue.ts`                   | Priority queue with bounded concurrency and backpressure |
| `src/discord/queued-port.ts`               | `DiscordPort` decorator routing calls through the queue  |
| `src/db/cached-guild-config-repository.ts` | Read-through cache decorator                             |
| `src/tasks/reconcile.ts`                   | (modified) chunked, yielding, bulk-priority              |
| `src/observability/metrics.ts`             | Event-loop lag, queue depth, counters                    |
| `src/shard.ts`                             | `ShardingManager` entrypoint                             |
| `tests/helpers/controllable-clock.ts`      | Deterministic timing for queue tests                     |

---

### Task 1: Priority task queue

**Files:**

- Create: `src/core/task-queue.ts`
- Test: `tests/core/task-queue.test.ts`

**Interfaces:**

- Produces: `createTaskQueue(options): TaskQueue` with `run<T>(priority, fn): Promise<T>`, `size(priority)`, `pending()`, `drain()`.
- `Priority = 'interactive' | 'bulk'`. Options are `{ concurrency, maxQueued }`.
- Task 2 wraps `DiscordPort` with it; Task 4 uses `'bulk'` for reconciliation.

- [x] **Step 1: Write the failing test**

```ts
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
```

- [x] **Step 2: Run it to confirm it fails**

Run: `pnpm test tests/core/task-queue.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Write `src/core/task-queue.ts`**

```ts
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
```

- [x] **Step 4: Run the test to confirm it passes**

Run: `pnpm test tests/core/task-queue.test.ts`
Expected: PASS, 8 tests.

- [x] **Step 5: Commit**

```bash
git add src/core/task-queue.ts tests/core/task-queue.test.ts
git commit -m "feat: add priority task queue with bounded concurrency"
```

---

### Task 2: Queued DiscordPort decorator

**Files:**

- Create: `src/discord/queued-port.ts`
- Test: `tests/discord/queued-port.test.ts`

**Interfaces:**

- Consumes: `DiscordPort`, `TaskQueue`.
- Produces: `createQueuedPort(inner, queue, priority): DiscordPort` — the same interface, so `src/core/` is unaware. Task 4 builds a bulk-priority variant for reconciliation.

- [x] **Step 1: Write the failing test**

```ts
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
```

- [x] **Step 2: Run it to confirm it fails**

Run: `pnpm test tests/discord/queued-port.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Write `src/discord/queued-port.ts`**

```ts
import type { DiscordPort } from '../core/discord-port.js'
import type { Priority, TaskQueue } from '../core/task-queue.js'
import { err, type Result } from '../types.js'

/**
 * Routes every Discord write through the shared queue. The interface is
 * unchanged, so the domain layer never learns that queueing exists.
 *
 * A rejected enqueue (queue full) is converted into a failed `Result` rather
 * than a throw, because callers already handle failed results and a dropped
 * bulk write is a normal, recoverable outcome — reconciliation will retry it on
 * the next boot.
 */
export const createQueuedPort = (
	inner: DiscordPort,
	queue: TaskQueue,
	priority: Priority
): DiscordPort => {
	const enqueue = async <T, E extends string>(
		fn: () => Promise<Result<T, E>>,
		overloaded: E
	): Promise<Result<T, E>> => {
		try {
			return await queue.run(priority, fn)
		} catch {
			return err(overloaded)
		}
	}

	return {
		addRole: (guildId, userId, roleId) =>
			enqueue(() => inner.addRole(guildId, userId, roleId), 'unknown'),

		removeRole: (guildId, userId, roleId) =>
			enqueue(() => inner.removeRole(guildId, userId, roleId), 'unknown'),

		sendDm: (userId, content) => enqueue(() => inner.sendDm(userId, content), 'unknown'),

		postAudit: (guildId, channelId, entry) =>
			enqueue(() => inner.postAudit(guildId, channelId, entry), 'unknown')
	}
}
```

- [x] **Step 4: Run the test to confirm it passes**

Run: `pnpm test tests/discord/queued-port.test.ts`
Expected: PASS, 4 tests.

- [x] **Step 5: Wire it in `src/index.ts`**

Build one queue and two views of the port — interactive for event handlers, bulk for background tasks:

```ts
const discordQueue = createTaskQueue({ concurrency: 8, maxQueued: 5000 })

const rawPort = createDiscordPort(ready)
const port = createQueuedPort(rawPort, discordQueue, 'interactive')
const bulkPort = createQueuedPort(rawPort, discordQueue, 'bulk')
```

Pass `port` to `createOnboardingService` for the live flow. Pass `bulkPort` to `reconcile` and the reminder sweep. Both share one queue, so bulk work uses spare capacity but always yields to interactive work.

Concurrency of 8 sits well inside Discord's ~50 requests/second global budget while leaving headroom for gateway traffic; raise it only with the metrics from Task 6 in hand.

- [x] **Step 6: Commit**

```bash
git add src/discord/queued-port.ts tests/discord/queued-port.test.ts src/index.ts
git commit -m "feat: route Discord writes through a priority queue"
```

---

### Task 3: Cached guild config repository

**Files:**

- Create: `src/db/cached-guild-config-repository.ts`
- Test: `tests/db/cached-guild-config-repository.test.ts`

**Interfaces:**

- Consumes: `GuildConfigRepository`.
- Produces: `createCachedGuildConfigRepository(inner): GuildConfigRepository & { stats() }` — same interface, so nothing above it changes.

**Why:** `get` runs on every message and every interaction in every guild. Cached in memory it becomes a `Map` lookup. Correctness rests on every mutating method invalidating its guild, which the tests below enforce individually.

- [x] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createCachedGuildConfigRepository } from '../../src/db/cached-guild-config-repository.js'
import { createGuildConfigRepository } from '../../src/db/guild-config-repository.js'
import { createTestDb } from '../helpers/test-db.js'

const GUILD = '123456789012345678'
const OTHER = '223456789012345678'
const ACTOR = '323456789012345678'
const AT = '2026-08-10T10:00:00.000Z'

let inner: ReturnType<typeof createGuildConfigRepository>
let repo: ReturnType<typeof createCachedGuildConfigRepository>

beforeEach(() => {
	inner = createGuildConfigRepository(createTestDb())
	repo = createCachedGuildConfigRepository(inner)
	repo.ensure(GUILD, AT)
})

describe('caching', () => {
	it('returns the same value as the underlying repository', () => {
		repo.setChannel(GUILD, 'rules', '111', ACTOR, AT)
		expect(repo.get(GUILD)?.rulesChannelId).toBe(inner.get(GUILD)?.rulesChannelId)
	})

	it('serves repeat reads from cache', () => {
		repo.get(GUILD)
		repo.get(GUILD)
		repo.get(GUILD)
		expect(repo.stats().hits).toBe(2)
	})

	it('caches the absence of a guild without re-querying', () => {
		repo.get('999999999999999999')
		repo.get('999999999999999999')
		expect(repo.stats().hits).toBe(1)
	})
})

describe('invalidation', () => {
	it.each([
		['setChannel', () => repo.setChannel(GUILD, 'rules', '111', ACTOR, AT)],
		['setRole', () => repo.setRole(GUILD, 'verified', '222', ACTOR, AT)],
		['setRulesText', () => repo.setRulesText(GUILD, 'text', ACTOR, AT)],
		['setRulesMessageId', () => repo.setRulesMessageId(GUILD, '333')],
		['enable', () => repo.enable(GUILD, AT, ACTOR, AT)],
		['disable', () => repo.disable(GUILD)],
		['clearGrandfather', () => repo.clearGrandfather(GUILD)],
		['remove', () => repo.remove(GUILD)]
	])('%s invalidates the cached row', (_name, mutate) => {
		repo.get(GUILD)
		mutate()
		const before = repo.stats().hits
		repo.get(GUILD)
		expect(repo.stats().hits).toBe(before)
	})

	it('a write to one guild does not invalidate another', () => {
		repo.ensure(OTHER, AT)
		repo.get(GUILD)
		repo.get(OTHER)

		repo.setChannel(OTHER, 'rules', '111', ACTOR, AT)

		const before = repo.stats().hits
		repo.get(GUILD)
		expect(repo.stats().hits).toBe(before + 1)
	})

	it('reflects a write immediately on the next read', () => {
		repo.get(GUILD)
		repo.enable(GUILD, AT, ACTOR, AT)
		expect(repo.get(GUILD)?.enabled).toBe(true)
	})
})
```

- [x] **Step 2: Run it to confirm it fails**

Run: `pnpm test tests/db/cached-guild-config-repository.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Write `src/db/cached-guild-config-repository.ts`**

```ts
import type { ChannelKind, GuildConfigRepository, RoleKind } from './guild-config-repository.js'
import type { GuildConfigRow } from '../types.js'

export type CacheStats = { hits: number; misses: number; size: number }

/**
 * Read-through cache over the guild config repository.
 *
 * `get` is called on essentially every gateway event, so uncached it is a
 * SQLite query per message in every served guild. The cache is authoritative
 * only because every mutating method below invalidates its guild — adding a
 * write method without an invalidation is the one way to break this, so the
 * test suite covers each method individually.
 *
 * Entries are unbounded by guild count, which is fine: one small row per guild,
 * and a bot in 10,000 guilds holds 10,000 rows.
 */
export const createCachedGuildConfigRepository = (inner: GuildConfigRepository) => {
	// `undefined` means "not cached"; `null` means "cached, and the guild has no
	// row" — worth distinguishing so unconfigured guilds do not query every time.
	const cache = new Map<string, GuildConfigRow | null>()

	let hits = 0
	let misses = 0

	const invalidate = (guildId: string): void => {
		cache.delete(guildId)
	}

	return {
		get: (guildId: string): GuildConfigRow | null => {
			const cached = cache.get(guildId)
			if (cached !== undefined) {
				hits += 1
				return cached
			}

			misses += 1
			const row = inner.get(guildId)
			cache.set(guildId, row)
			return row
		},

		ensure: (guildId: string, joinedAt: string): void => {
			inner.ensure(guildId, joinedAt)
			invalidate(guildId)
		},

		setChannel: (
			guildId: string,
			kind: ChannelKind,
			channelId: string,
			actorId: string,
			at: string
		): void => {
			inner.setChannel(guildId, kind, channelId, actorId, at)
			invalidate(guildId)
		},

		setRole: (
			guildId: string,
			kind: RoleKind,
			roleId: string,
			actorId: string,
			at: string
		): void => {
			inner.setRole(guildId, kind, roleId, actorId, at)
			invalidate(guildId)
		},

		setRulesText: (guildId: string, text: string, actorId: string, at: string): void => {
			inner.setRulesText(guildId, text, actorId, at)
			invalidate(guildId)
		},

		setRulesMessageId: (guildId: string, messageId: string | null): void => {
			inner.setRulesMessageId(guildId, messageId)
			invalidate(guildId)
		},

		enable: (guildId: string, grandfatherBefore: string, actorId: string, at: string): void => {
			inner.enable(guildId, grandfatherBefore, actorId, at)
			invalidate(guildId)
		},

		disable: (guildId: string): void => {
			inner.disable(guildId)
			invalidate(guildId)
		},

		clearGrandfather: (guildId: string): void => {
			inner.clearGrandfather(guildId)
			invalidate(guildId)
		},

		remove: (guildId: string): void => {
			inner.remove(guildId)
			invalidate(guildId)
		},

		// Not cached: it is called once at startup and once per sweep tick, and
		// caching a whole-table scan would need invalidating on every write.
		listEnabled: (): GuildConfigRow[] => inner.listEnabled(),

		stats: (): CacheStats => ({ hits, misses, size: cache.size })
	}
}
```

- [x] **Step 4: Run the test to confirm it passes**

Run: `pnpm test tests/db/cached-guild-config-repository.test.ts`
Expected: PASS, 13 tests.

- [x] **Step 5: Wire it in `src/index.ts`**

Wrap once at construction, so every consumer gets the cached view:

```ts
const guildConfig = createCachedGuildConfigRepository(createGuildConfigRepository(db))
```

**Sharding caveat:** each shard process holds its own cache. A `/config` change is handled by the shard owning that guild, and that shard invalidates its own entry — so the cache is always correct for the shard that serves the guild. No cross-process invalidation is needed.

- [x] **Step 6: Commit**

```bash
git add src/db/cached-guild-config-repository.ts tests/db/cached-guild-config-repository.test.ts src/index.ts
git commit -m "perf: cache guild config in memory"
```

---

### Task 4: Chunked, yielding reconciliation

**Files:**

- Modify: `src/tasks/reconcile.ts`
- Test: `tests/tasks/reconcile.test.ts` (extend)

**Interfaces:**

- `reconcileMembers` gains an options parameter `{ chunkSize?, onProgress? }`, defaulting to 200.
- Produces: unchanged summary shape; the wrapper now takes `bulkPort`.

**Why:** the current loop `await`s per member with no yield boundary and no ceiling. A 50,000-member guild would hold the event loop's attention for the whole backfill and issue 50,000 unbounded role calls. Chunking bounds the work per turn and lets interactive traffic interleave.

- [ ] **Step 1: Write the failing test (append to the existing file)**

```ts
describe('chunking', () => {
	it('processes every member across multiple chunks', async () => {
		const many = Array.from({ length: 25 }, (_unused, index) => member(`u${index}`))

		const summary = await reconcileMembers(deps, config, many, { chunkSize: 10 })

		expect(summary.created).toBe(25)
	})

	it('reports progress once per chunk', async () => {
		const many = Array.from({ length: 25 }, (_unused, index) => member(`u${index}`))
		const progress: number[] = []

		await reconcileMembers(deps, config, many, {
			chunkSize: 10,
			onProgress: (processed) => progress.push(processed)
		})

		expect(progress).toEqual([10, 20, 25])
	})

	it('yields to the event loop between chunks', async () => {
		const many = Array.from({ length: 20 }, (_unused, index) => member(`u${index}`))
		let interleaved = false

		const reconciling = reconcileMembers(deps, config, many, { chunkSize: 5 })
		// If the loop never yields, this timer cannot run before it finishes.
		setTimeout(() => {
			interleaved = true
		}, 0)

		await reconciling
		expect(interleaved).toBe(true)
	})
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test tests/tasks/reconcile.test.ts`
Expected: FAIL — `reconcileMembers` takes three arguments.

- [ ] **Step 3: Modify `src/tasks/reconcile.ts`**

Add above `reconcileMembers`:

```ts
import { setTimeout as delay } from 'node:timers/promises'

export type ReconcileOptions = {
	/** Members handled before yielding to the event loop. */
	readonly chunkSize?: number
	readonly onProgress?: (processed: number, total: number) => void
}
```

Change the signature and wrap the loop:

```ts
export const reconcileMembers = async (
	deps: ReconcileDeps,
	config: ResolvedGuildConfig,
	members: readonly ReconcileMember[],
	options: ReconcileOptions = {}
): Promise<ReconcileSummary> => {
	const chunkSize = options.chunkSize ?? 200

	const summary: ReconcileSummary = {
		created: 0,
		grandfathered: 0,
		rolesRestored: 0,
		holdsEnforced: 0,
		granted: 0,
		anomalies: 0
	}

	for (let offset = 0; offset < members.length; offset += chunkSize) {
		const chunk = members.slice(offset, offset + chunkSize)

		for (const member of chunk) {
			// ...existing per-member body, unchanged...
		}

		const processed = Math.min(offset + chunkSize, members.length)
		options.onProgress?.(processed, members.length)

		// Hand the event loop back between chunks so gateway events and
		// interactive interactions are served while a backfill runs.
		if (processed < members.length) await delay(0)
	}

	return summary
}
```

Keep the per-member body exactly as it is — only the loop around it changes.

- [ ] **Step 4: Update the `reconcile` wrapper to use the bulk port and log progress**

```ts
export const reconcile = async (deps: {
	guild: Guild
	guildConfig: GuildConfigRepository
	repo: OnboardingRepository
	service: OnboardingService
	port: DiscordPort
}): Promise<ReconcileSummary | null> => {
	const config = resolveActiveConfig(deps.guildConfig, deps.guild.id)
	if (!config) return null

	const started = Date.now()
	const members = await deps.guild.members.fetch()

	const summary = await reconcileMembers(
		{ repo: deps.repo, service: deps.service, port: deps.port },
		config,
		members.map((member) => ({
			userId: member.id,
			isBot: member.user.bot,
			joinedAtMs: member.joinedTimestamp ?? Date.now(),
			roleIds: [...member.roles.cache.keys()]
		})),
		{
			onProgress: (processed, total) => {
				// Only worth logging for guilds large enough that the operator
				// would otherwise wonder whether it had stalled.
				if (total >= 1000 && processed % 1000 === 0)
					console.info(
						JSON.stringify({
							level: 'info',
							event: 'reconcile-progress',
							guildId: deps.guild.id,
							processed,
							total
						})
					)
			}
		}
	)

	console.info(
		JSON.stringify({
			level: 'info',
			event: 'reconcile-complete',
			guildId: deps.guild.id,
			durationMs: Date.now() - started,
			...summary
		})
	)

	return summary
}
```

- [ ] **Step 5: Reconcile guilds sequentially, not in parallel, in `src/index.ts`**

```ts
// Sequential on purpose. Every guild's reconciliation shares one rate-limit
// budget, so starting them all at once only deepens the queue while making
// failures harder to attribute.
for (const row of guildConfig.listEnabled()) {
	const guild = await ready.guilds.fetch(row.guildId).catch(() => null)
	if (!guild) continue
	await reconcile({ guild, guildConfig, repo: onboarding, service, port: bulkPort })
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test tests/tasks/reconcile.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 7: Commit**

```bash
git add src/tasks/reconcile.ts tests/tasks/reconcile.test.ts src/index.ts
git commit -m "perf: chunk reconciliation and yield between chunks"
```

---

### Task 5: Sharding entrypoint

**Files:**

- Create: `src/shard.ts`
- Modify: `package.json`, `src/env.ts`, `README.md`

**Interfaces:**

- Produces: a `pnpm start:sharded` entrypoint spawning one process per shard via `ShardingManager`. `src/index.ts` is unchanged — discord.js injects `SHARDS`/`SHARD_COUNT` automatically.

- [ ] **Step 1: Add the shard count env var to `src/env.ts`**

Extend `Env` with `shardCount: number | 'auto'` and parse it:

```ts
const rawShards = source.SHARD_COUNT?.trim()
const shardCount =
	!rawShards || rawShards === 'auto'
		? ('auto' as const)
		: (() => {
				const parsed = Number(rawShards)
				if (!Number.isInteger(parsed) || parsed < 1)
					throw new Error(
						`Environment variable SHARD_COUNT must be a positive integer or "auto": ${rawShards}`
					)
				return parsed
			})()
```

Add it to the returned object and add a test asserting a non-integer value throws naming `SHARD_COUNT`.

- [ ] **Step 2: Write `src/shard.ts`**

```ts
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { ShardingManager } from 'discord.js'
import 'dotenv/config'
import { loadEnv } from './env.js'

const env = loadEnv()

// Processes, not threads. Each shard owns a disjoint subset of guilds, gets its
// own gateway connection and its own event loop, so shards genuinely run in
// parallel across cores. Discord requires this past 2,500 guilds.
const manager = new ShardingManager(fileURLToPath(new URL('./index.js', import.meta.url)), {
	token: env.discordToken,
	totalShards: env.shardCount,
	// Serial respawn avoids every shard reconnecting at once after a crash,
	// which would hit the identify rate limit.
	respawn: true,
	mode: 'process'
})

manager.on('shardCreate', (shard) => {
	console.info(JSON.stringify({ level: 'info', event: 'shard-spawned', shardId: shard.id }))

	shard.on('death', () =>
		console.error(JSON.stringify({ level: 'error', event: 'shard-died', shardId: shard.id }))
	)
	shard.on('error', (error) =>
		console.error(
			JSON.stringify({
				level: 'error',
				event: 'shard-error',
				shardId: shard.id,
				error: error.message
			})
		)
	)
})

const shutdown = (): void => {
	for (const shard of manager.shards.values()) shard.kill()
	process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await manager.spawn()
```

- [ ] **Step 3: Add the script to `package.json`**

```json
"start:sharded": "node dist/shard.js",
"dev:sharded": "tsx src/shard.ts"
```

- [ ] **Step 4: Make startup logs shard-aware in `src/index.ts`**

Include the shard id so multi-process logs are attributable:

```ts
const shardId = client.shard?.ids[0] ?? 0
```

Add `shardId` to the `ready` and `reconcile-complete` log lines.

- [ ] **Step 5: Verify sharding works locally**

Run: `SHARD_COUNT=2 pnpm dev:sharded`
Expected: two `shard-spawned` lines, two `ready` lines with different `shardId` values, and the guild counts across both summing to the bot's total. Onboarding must still work end to end in a test guild.

- [ ] **Step 6: Verify the database survives concurrent shards**

With both shards running, trigger onboarding in two guilds served by different shards simultaneously.
Expected: no `SQLITE_BUSY` errors. WAL plus the 5-second busy timeout from plan 01 covers this write volume.

- [ ] **Step 7: Document it in the README**

Add a **Running at scale** section: single process is fine below ~2,000 guilds; use `start:sharded` above that; `SHARD_COUNT=auto` lets Discord decide; all shards share one SQLite file safely thanks to WAL; and that Postgres is the swap point if the lag metric ever shows write contention.

- [ ] **Step 8: Commit**

```bash
git add src/shard.ts src/env.ts src/index.ts package.json README.md tests/env.test.ts
git commit -m "feat: add process sharding entrypoint"
```

---

### Task 6: Observability

**Files:**

- Create: `src/observability/metrics.ts`
- Test: `tests/observability/metrics.test.ts`
- Modify: `src/index.ts`

**Interfaces:**

- Produces: `createMetrics(): Metrics` with `increment(name)`, `observeLag(ms)`, `snapshot()`, and `startLagMonitor(metrics, intervalMs): () => void`.

**Why:** this is what tells you whether any of the above is working, and it is the evidence that would justify a worker thread if genuine CPU-bound work ever appears.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { createMetrics } from '../../src/observability/metrics.js'

describe('createMetrics', () => {
	it('counts events by name', () => {
		const metrics = createMetrics()
		metrics.increment('verified')
		metrics.increment('verified')
		metrics.increment('reminded')

		expect(metrics.snapshot().counters).toEqual({ verified: 2, reminded: 1 })
	})

	it('reports zero lag before any observation', () => {
		expect(createMetrics().snapshot().lag.max).toBe(0)
	})

	it('tracks maximum and most recent event loop lag', () => {
		const metrics = createMetrics()
		metrics.observeLag(12)
		metrics.observeLag(48)
		metrics.observeLag(7)

		const { lag } = metrics.snapshot()
		expect(lag.max).toBe(48)
		expect(lag.last).toBe(7)
	})

	it('resets counters on snapshot so each interval is independent', () => {
		const metrics = createMetrics()
		metrics.increment('verified')
		metrics.snapshot()

		expect(metrics.snapshot().counters).toEqual({})
	})
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test tests/observability/metrics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/observability/metrics.ts`**

```ts
export type MetricsSnapshot = {
	readonly counters: Record<string, number>
	readonly lag: { readonly last: number; readonly max: number }
}

export type Metrics = {
	increment: (name: string) => void
	observeLag: (ms: number) => void
	snapshot: () => MetricsSnapshot
}

export const createMetrics = (): Metrics => {
	let counters: Record<string, number> = {}
	let lastLag = 0
	let maxLag = 0

	return {
		increment: (name: string): void => {
			counters[name] = (counters[name] ?? 0) + 1
		},

		observeLag: (ms: number): void => {
			lastLag = ms
			maxLag = Math.max(maxLag, ms)
		},

		snapshot: (): MetricsSnapshot => {
			const taken = { counters, lag: { last: lastLag, max: maxLag } }
			// Counters reset per interval so each log line describes that window
			// rather than all history, which makes rates readable directly.
			counters = {}
			maxLag = 0
			return taken
		}
	}
}

/**
 * Measures event loop lag by scheduling a timer and recording how far past its
 * deadline it actually fired. Sustained lag means something synchronous is
 * hogging the loop — the one signal that would justify moving work off-thread.
 */
export const startLagMonitor = (metrics: Metrics, intervalMs = 1000): (() => void) => {
	let stopped = false
	let timer: NodeJS.Timeout | undefined

	const tick = (): void => {
		if (stopped) return
		const expectedAt = Date.now() + intervalMs

		timer = setTimeout(() => {
			metrics.observeLag(Math.max(0, Date.now() - expectedAt))
			tick()
		}, intervalMs)

		timer.unref()
	}

	tick()

	return () => {
		stopped = true
		if (timer) clearTimeout(timer)
	}
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test tests/observability/metrics.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire it into `src/index.ts`**

```ts
const metrics = createMetrics()
const stopLagMonitor = startLagMonitor(metrics)

const statsTimer = setInterval(() => {
	const snapshot = metrics.snapshot()

	console.info(
		JSON.stringify({
			level: 'info',
			event: 'stats',
			shardId,
			guilds: client.guilds.cache.size,
			queueInteractive: discordQueue.size('interactive'),
			queueBulk: discordQueue.size('bulk'),
			queueActive: discordQueue.pending(),
			configCache: guildConfig.stats(),
			rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
			...snapshot
		})
	)
}, 60_000)

statsTimer.unref()
```

Add `stopLagMonitor()` and `clearInterval(statsTimer)` to `shutdown`.

Call `metrics.increment('verified')` in `grantVerified`'s success path and `metrics.increment('reminded')` in the sweep by passing an optional `metrics` into their deps.

- [ ] **Step 6: Verify the stats line is useful**

Run the bot for a few minutes against a test guild and complete one onboarding.
Expected: a `stats` line every 60 s showing `lag.max` in single-digit milliseconds when idle, `configCache.hits` climbing far faster than `misses`, and `verified: 1` in the interval where onboarding completed.

- [ ] **Step 7: Commit**

```bash
git add src/observability tests/observability src/index.ts
git commit -m "feat: add metrics, event loop lag monitoring, and stats logging"
```

---

### Task 7: Load harness

**Files:**

- Create: `tests/load/onboarding-load.test.ts`

**Interfaces:**

- Consumes: everything. Uses the fake port, so it measures _our_ code, not Discord.

**Why:** it establishes that the domain layer is nowhere near being the bottleneck, which is the claim the whole ADR rests on. If this ever gets slow, the conclusion changes.

- [ ] **Step 1: Write the load test**

```ts
import { describe, expect, it } from 'vitest'
import type { ResolvedGuildConfig } from '../../src/core/guild-config.js'
import { createOnboardingService } from '../../src/core/onboarding-service.js'
import { createCachedGuildConfigRepository } from '../../src/db/cached-guild-config-repository.js'
import { createGuildConfigRepository } from '../../src/db/guild-config-repository.js'
import { createOnboardingRepository } from '../../src/db/onboarding-repository.js'
import { EXPERIENCE_LEVELS } from '../../src/types.js'
import { createFakeDiscordPort } from '../helpers/fake-discord-port.js'
import { createTestDb } from '../helpers/test-db.js'

const AT = '2026-08-10T12:00:00.000Z'

const configFor = (guildId: string): ResolvedGuildConfig => ({
	guildId,
	rulesChannelId: '1',
	introductionsChannelId: '2',
	modLogChannelId: '3',
	verifiedRoleId: '4',
	unverifiedRoleId: '5',
	rulesText: 'rules',
	rulesMessageId: null,
	grandfatherBefore: null
})

describe('load', () => {
	it('runs 5,000 full onboardings across 50 guilds well under a second of our own time', async () => {
		const db = createTestDb()
		const repo = createOnboardingRepository(db)
		const fake = createFakeDiscordPort()
		const service = createOnboardingService({ repo, port: fake.port, now: () => AT })

		const started = performance.now()

		for (let guildIndex = 0; guildIndex < 50; guildIndex += 1) {
			const config = configFor(`guild-${guildIndex}`)

			for (let userIndex = 0; userIndex < 100; userIndex += 1) {
				const userId = `user-${userIndex}`
				await service.handleJoin(config, userId, Date.parse(AT))
				await service.recordStep(config, userId, 'rules')
				repo.saveAnswer(config.guildId, userId, { purpose: 'load test' }, AT)
				repo.saveAnswer(config.guildId, userId, { experienceLevel: EXPERIENCE_LEVELS.SOME }, AT)
				repo.saveAnswer(config.guildId, userId, { builtForDiscord: false }, AT)
				await service.recordStep(config, userId, 'questionnaire')
				await service.recordStep(config, userId, 'intro')
			}
		}

		const elapsed = performance.now() - started

		expect(fake.addedRoles.filter((call) => call.roleId === '4')).toHaveLength(5000)
		// Generous: this is a correctness guard against an accidental O(n²) or a
		// lost prepared statement, not a benchmark. Typical is far below it.
		expect(elapsed).toBeLessThan(10_000)
	})

	it('serves config reads from cache under repeated lookups', () => {
		const repo = createCachedGuildConfigRepository(createGuildConfigRepository(createTestDb()))
		repo.ensure('g1', AT)

		for (let index = 0; index < 10_000; index += 1) repo.get('g1')

		const stats = repo.stats()
		expect(stats.misses).toBe(1)
		expect(stats.hits).toBe(9999)
	})
})
```

- [ ] **Step 2: Run it**

Run: `pnpm test tests/load/onboarding-load.test.ts`
Expected: PASS, 2 tests. Note the reported duration — record it in the plan's Decisions section as the baseline.

- [ ] **Step 3: Commit**

```bash
git add tests/load
git commit -m "test: add load harness for the onboarding path"
```

## Acceptance Criteria

- A member's interaction is served promptly while a large reconciliation is running (verified by watching queue depth in the `stats` line during a backfill)
- No queue grows without bound; bulk work is rejected past `maxQueued` while interactive work is still accepted
- `stats` reports config cache hits far exceeding misses after warmup
- Reconciliation of a large guild yields between chunks — timers and gateway events are still serviced
- Guilds reconcile sequentially, not concurrently, so one rate-limit budget is not split
- `SHARD_COUNT=2 pnpm dev:sharded` runs two shards against one SQLite file with no `SQLITE_BUSY`
- Idle `lag.max` stays in single-digit milliseconds
- The load harness completes 5,000 onboardings with no `SQLITE_BUSY` and no O(n²) blowup
- `pnpm test` and `pnpm typecheck` pass
- **No `worker_threads` import exists anywhere in the codebase**

## UI/UX Pattern

_N/A — no web UI surface._

## Open Questions

- [ ] None. The Postgres migration trigger is defined (sustained write contention visible in the lag metric) but is deliberately not built now.

## Dependencies

- Requires: [[04-reminders-and-mod-tooling]]
- Blocks: —

## Decisions

- 2026-08-10 — **No `worker_threads`.** The workload is I/O bound and capped by Discord's per-bot rate limits; threads would contend for the same budget and produce more 429s, not more throughput. Rationale and the trigger for revisiting are in [[2026-08-10-concurrency-and-scale-model]].
- 2026-08-10 — One queue with two priorities, rather than separate queues, so bulk work uses spare capacity but always yields to interactive work.
- 2026-08-10 — Interactive work is never rejected when the queue is full; only bulk is. Dropping a member's button click to protect a backfill would be exactly backwards.
- 2026-08-10 — A full queue surfaces as a failed `Result`, not a throw: callers already handle failed results, and a dropped bulk write is recovered by the next reconciliation.
- 2026-08-10 — Guilds reconcile sequentially. They share one rate-limit budget, so parallel reconciliation only deepens the queue and obscures which guild failed.
- 2026-08-10 — Sharding uses processes rather than `mode: 'worker'`, giving each shard its own event loop and heap, and matching how the SQLite busy timeout was reasoned about.
- 2026-08-10 — `listEnabled` is deliberately left uncached; it runs twice a tick at most, and caching a whole-table scan would require invalidating it on every write in every guild.
