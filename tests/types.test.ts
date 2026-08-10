import { describe, expect, it } from 'vitest'
import { err, isOk, ok } from '../src/types.js'

describe('Result', () => {
	it('marks a success value as ok and exposes it', () => {
		const result = ok(42)
		expect(isOk(result)).toBe(true)
		if (isOk(result)) expect(result.value).toBe(42)
	})

	it('marks a failure as not ok and exposes the error', () => {
		const result = err('boom')
		expect(isOk(result)).toBe(false)
		if (!isOk(result)) expect(result.error).toBe('boom')
	})
})
