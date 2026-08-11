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
