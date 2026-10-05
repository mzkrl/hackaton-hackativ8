/**
 * A timeout, as a promise rejection.
 *
 * A plain `Error` would do, but a distinct name lets a caller tell "this run
 * outlived its slot" apart from "this run failed" without string-matching a
 * message. The two want opposite responses: a timeout means the work may still
 * land and should be re-checked, a failure means it will not and should be
 * recorded.
 */
export class TimeoutError extends Error {
	constructor(ms: number) {
		super(`Timed out after ${ms}ms`);
		this.name = "TimeoutError";
	}
}

/**
 * Races a promise against a deadline.
 *
 * The timer is cleared when the wrapped promise settles, so a fast run does not
 * leave a pending timer keeping the event loop alive. The wrapped promise is
 * *not* cancelled -- JS has no general way to do that -- so a run that ignores
 * the deadline keeps running in the background. Callers rely on that: the whole
 * point is that the work may still complete after the caller has stopped
 * waiting, and the re-check reads the result off the database when it does.
 */
export const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
	new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);

		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});

export const isTimeout = (error: unknown): boolean =>
	error instanceof Error && error.name === "TimeoutError";
