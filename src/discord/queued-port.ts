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
