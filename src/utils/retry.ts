/**
 * Retry Utility with Exponential Backoff
 *
 * Provides resilient API calls with configurable retry logic.
 */

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  retryableErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'EPIPE',
    'EHOSTUNREACH',
    'EAI_AGAIN',
    'socket hang up',
    'network error',
    'timeout',
    '429', // Rate limited
    '502', // Bad gateway
    '503', // Service unavailable
    '504', // Gateway timeout
  ],
};

function isRetryable(error: Error, retryableErrors: string[]): boolean {
  const errorString = `${error.message} ${error.name} ${(error as any).code || ''}`.toLowerCase();
  return retryableErrors.some((retryable) => errorString.includes(retryable.toLowerCase()));
}

function calculateDelay(attempt: number, options: RetryOptions): number {
  // Exponential backoff with jitter
  const exponentialDelay = options.baseDelayMs * Math.pow(options.backoffMultiplier, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
  return Math.min(exponentialDelay + jitter, options.maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on final attempt or non-retryable errors
      if (attempt === opts.maxRetries) {
        break;
      }

      if (!isRetryable(lastError, opts.retryableErrors || [])) {
        throw lastError;
      }

      const delayMs = calculateDelay(attempt, opts);

      if (opts.onRetry) {
        opts.onRetry(attempt + 1, lastError, delayMs);
      }

      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Create a retryable version of an async function
 */
export function makeRetryable<TArgs extends any[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: Partial<RetryOptions> = {}
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => withRetry(() => fn(...args), options);
}
