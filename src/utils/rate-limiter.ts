/**
 * Token Bucket Rate Limiter for Telegram API
 *
 * Telegram limits:
 * - 30 messages per second globally
 * - 20 messages per minute per chat
 */

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

interface RateLimiterConfig {
  /** Max requests per second globally (default: 30) */
  maxRequestsPerSecond: number;
  /** Max requests per minute per chat (default: 20) */
  maxRequestsPerMinutePerChat: number;
  /** Burst size for global limiter (default: 5) */
  burstSize: number;
}

export class TelegramRateLimiter {
  private readonly config: RateLimiterConfig;
  private globalBucket: TokenBucket;
  private chatBuckets: Map<number, TokenBucket> = new Map();

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = {
      maxRequestsPerSecond: config.maxRequestsPerSecond ?? 30,
      maxRequestsPerMinutePerChat: config.maxRequestsPerMinutePerChat ?? 20,
      burstSize: config.burstSize ?? 5,
    };

    this.globalBucket = {
      tokens: this.config.maxRequestsPerSecond,
      lastRefill: Date.now(),
    };
  }

  /**
   * Execute a function with rate limiting
   */
  async throttle<T>(chatId: number, fn: () => Promise<T>): Promise<T> {
    await this.acquireToken(chatId);

    try {
      return await fn();
    } finally {
      // Tokens are consumed, no refill needed on completion
    }
  }

  /**
   * Acquire a token, waiting if necessary
   */
  private async acquireToken(chatId: number): Promise<void> {
    // Wait for global rate limit
    await this.waitForGlobalToken();

    // Wait for per-chat rate limit
    await this.waitForChatToken(chatId);
  }

  /**
   * Wait for global token availability
   */
  private async waitForGlobalToken(): Promise<void> {
    while (true) {
      this.refillGlobalBucket();

      if (this.globalBucket.tokens >= 1) {
        this.globalBucket.tokens -= 1;
        return;
      }

      // Wait for token refill (1 second / max requests)
      const waitTime = 1000 / this.config.maxRequestsPerSecond;
      await this.sleep(waitTime);
    }
  }

  /**
   * Wait for per-chat token availability
   */
  private async waitForChatToken(chatId: number): Promise<void> {
    while (true) {
      this.refillChatBucket(chatId);

      const bucket = this.getChatBucket(chatId);
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return;
      }

      // Wait for token refill (60 seconds / max requests per minute)
      const waitTime = 60000 / this.config.maxRequestsPerMinutePerChat;
      await this.sleep(waitTime);
    }
  }

  /**
   * Refill global bucket based on elapsed time
   */
  private refillGlobalBucket(): void {
    const now = Date.now();
    const elapsed = now - this.globalBucket.lastRefill;

    // Calculate tokens to add (tokens per millisecond * elapsed time)
    const tokensToAdd = (elapsed / 1000) * this.config.maxRequestsPerSecond;

    if (tokensToAdd >= 1) {
      this.globalBucket.tokens = Math.min(
        this.globalBucket.tokens + Math.floor(tokensToAdd),
        this.config.maxRequestsPerSecond + this.config.burstSize
      );
      this.globalBucket.lastRefill = now;
    }
  }

  /**
   * Refill per-chat bucket based on elapsed time
   */
  private refillChatBucket(chatId: number): void {
    const bucket = this.getChatBucket(chatId);
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;

    // Calculate tokens to add (tokens per millisecond * elapsed time)
    const tokensToAdd = (elapsed / 60000) * this.config.maxRequestsPerMinutePerChat;

    if (tokensToAdd >= 1) {
      bucket.tokens = Math.min(
        bucket.tokens + Math.floor(tokensToAdd),
        this.config.maxRequestsPerMinutePerChat
      );
      bucket.lastRefill = now;
    }
  }

  /**
   * Get or create a chat bucket
   */
  private getChatBucket(chatId: number): TokenBucket {
    let bucket = this.chatBuckets.get(chatId);

    if (!bucket) {
      bucket = {
        tokens: this.config.maxRequestsPerMinutePerChat,
        lastRefill: Date.now(),
      };
      this.chatBuckets.set(chatId, bucket);
    }

    return bucket;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get current global tokens available
   */
  get globalTokens(): number {
    this.refillGlobalBucket();
    return this.globalBucket.tokens;
  }

  /**
   * Get current tokens for a specific chat
   */
  getChatTokens(chatId: number): number {
    this.refillChatBucket(chatId);
    return this.getChatBucket(chatId).tokens;
  }

  /**
   * Clear old chat buckets to prevent memory leaks
   * Call periodically (e.g., every hour)
   */
  cleanupOldBuckets(maxAge: number = 3600000): void {
    const now = Date.now();

    for (const [chatId, bucket] of this.chatBuckets.entries()) {
      if (now - bucket.lastRefill > maxAge) {
        this.chatBuckets.delete(chatId);
      }
    }
  }

  /**
   * Get statistics for monitoring
   */
  getStats(): {
    globalTokens: number;
    activeChatBuckets: number;
    config: RateLimiterConfig;
  } {
    return {
      globalTokens: this.globalTokens,
      activeChatBuckets: this.chatBuckets.size,
      config: { ...this.config },
    };
  }
}

// Singleton instance for convenience
let defaultLimiter: TelegramRateLimiter | null = null;

export function getDefaultRateLimiter(): TelegramRateLimiter {
  if (!defaultLimiter) {
    defaultLimiter = new TelegramRateLimiter();
  }
  return defaultLimiter;
}

export function resetDefaultRateLimiter(): void {
  defaultLimiter = null;
}
