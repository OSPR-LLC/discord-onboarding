export const safeHandler =
	<Args extends unknown[]>(name: string, handler: (...args: Args) => Promise<void>) =>
	(...args: Args): void => {
		handler(...args).catch((error: unknown) => {
			console.error(
				JSON.stringify({
					level: 'error',
					event: 'handler-failed',
					handler: name,
					error: error instanceof Error ? error.message : String(error)
				})
			)
		})
	}
