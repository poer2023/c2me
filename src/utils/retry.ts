/**
 * Exponential Backoff Retry Utility
 *
 * Implements exponential backoff with jitter for retrying failed operations.
 * Used for Telegram API calls that fail due to rate limits or transient errors.
 */

export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries?: number;
  /** Initial delay in milliseconds */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff */
  backoffMultiplier?: number;
  /** Whether to add jitter to prevent thundering herd */
  jitter?: boolean;
  /** Custom function to determine if error is retryable */
  isRetryable?: (error: unknown) => boolean;
}

const DEFAULT_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
  isRetryable: () => true,
};

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalDelayMs: number;
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate delay with optional jitter
 */
function calculateDelay(
  attempt: number,
  config: Required<RetryConfig>
): number {
  // Exponential backoff: initialDelay * (multiplier ^ attempt)
  let delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);

  // Cap at max delay
  delay = Math.min(delay, config.maxDelayMs);

  // Add jitter (±25%)
  if (config.jitter) {
    const jitterFactor = 0.75 + Math.random() * 0.5; // 0.75 to 1.25
    delay = Math.floor(delay * jitterFactor);
  }

  return delay;
}

/**
 * Check if an error is a Telegram rate limit error
 */
export function isTelegramRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('too many requests') ||
      message.includes('retry after') ||
      message.includes('429') ||
      message.includes('flood')
    );
  }
  return false;
}

/**
 * Extract retry-after duration from Telegram error
 */
export function extractRetryAfter(error: unknown): number | null {
  if (error instanceof Error) {
    const match = error.message.match(/retry after (\d+)/i);
    if (match && match[1]) {
      return parseInt(match[1], 10) * 1000; // Convert to milliseconds
    }
  }
  return null;
}

/**
 * Default retry condition for Telegram API calls
 */
export function isTelegramRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Retry on rate limits
    if (isTelegramRateLimitError(error)) return true;

    // Retry on network errors
    if (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('socket hang up')
    ) {
      return true;
    }

    // Retry on server errors (5xx)
    if (message.includes('500') || message.includes('502') || message.includes('503')) {
      return true;
    }
  }

  return false;
}

/**
 * Execute a function with exponential backoff retry
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<RetryResult<T>> {
  const mergedConfig: Required<RetryConfig> = { ...DEFAULT_CONFIG, ...config };
  let lastError: Error | undefined;
  let totalDelayMs = 0;

  for (let attempt = 0; attempt <= mergedConfig.maxRetries; attempt++) {
    try {
      const data = await fn();
      return {
        success: true,
        data,
        attempts: attempt + 1,
        totalDelayMs,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      if (attempt >= mergedConfig.maxRetries || !mergedConfig.isRetryable(error)) {
        return {
          success: false,
          error: lastError,
          attempts: attempt + 1,
          totalDelayMs,
        };
      }

      // Check for Telegram-specific retry-after
      const retryAfter = extractRetryAfter(error);
      const delay = retryAfter ?? calculateDelay(attempt, mergedConfig);

      console.debug(
        `[Retry] Attempt ${attempt + 1}/${mergedConfig.maxRetries + 1} failed, ` +
        `retrying in ${delay}ms: ${lastError.message}`
      );

      await sleep(delay);
      totalDelayMs += delay;
    }
  }

  // Should not reach here, but just in case
  return {
    success: false,
    error: lastError || new Error('Unknown error'),
    attempts: mergedConfig.maxRetries + 1,
    totalDelayMs,
  };
}

/**
 * Wrap a function with automatic retry
 */
export function withAutoRetry<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  config: RetryConfig = {}
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const result = await withRetry(() => fn(...args), config);

    if (!result.success) {
      throw result.error;
    }

    return result.data!;
  };
}

/**
 * Create a retry wrapper with Telegram-specific defaults
 */
export function createTelegramRetry<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  overrides: Partial<RetryConfig> = {}
): (...args: TArgs) => Promise<TResult> {
  return withAutoRetry(fn, {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 60000, // Telegram rate limits can be up to 60s
    jitter: true,
    isRetryable: isTelegramRetryable,
    ...overrides,
  });
}
