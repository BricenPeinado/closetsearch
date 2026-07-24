const retryableSqlStates = new Set([
  "40001",
  "40P01",
  "53300",
  "57P01",
  "57P02",
  "57P03",
]);

export function postgresErrorCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }

  return undefined;
}

export function isTransientPostgresError(error: unknown) {
  const code = postgresErrorCode(error);

  return Boolean(
    code &&
      (retryableSqlStates.has(code) ||
        code.startsWith("08")),
  );
}

export interface RetryOptions {
  attempts: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  signal?: AbortSignal;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

function wait(delayMs: number, signal?: AbortSignal) {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error("Retry aborted."));
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, delayMs);

    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason ?? new Error("Retry aborted."));
      },
      { once: true },
    );
  });
}

export async function withTransientPostgresRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
) {
  const baseDelayMs = options.baseDelayMs ?? 25;
  const maxDelayMs = options.maxDelayMs ?? 1_000;
  const random = options.random ?? Math.random;
  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (
        attempt >= options.attempts ||
        !isTransientPostgresError(error)
      ) {
        throw error;
      }

      attempt += 1;
      const exponentialDelay = Math.min(
        maxDelayMs,
        baseDelayMs * 2 ** (attempt - 1),
      );
      const delayMs = Math.max(
        0,
        Math.round(exponentialDelay * (0.75 + random() * 0.5)),
      );
      options.onRetry?.(error, attempt, delayMs);
      await wait(delayMs, options.signal);
    }
  }
}
