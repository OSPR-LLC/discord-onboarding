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
