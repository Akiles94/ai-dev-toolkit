/** The outcome of an operation that can fail in an expected way: errors are values, not throws. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const fail = <E>(error: E): Result<never, E> => ({ ok: false, error });
