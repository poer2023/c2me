/**
 * Message Deduplication Utility
 *
 * Uses xxhash for fast hashing and LRU cache for storage.
 * Prevents duplicate messages within a configurable time window.
 */

import { LRUCache } from 'lru-cache';
import xxhash from 'xxhash-wasm';

export interface DeduplicationConfig {
  /** Maximum number of entries in the cache */
  maxSize?: number;
  /** Time-to-live for each entry in milliseconds */
  ttlMs?: number;
}

const DEFAULT_CONFIG: Required<DeduplicationConfig> = {
  maxSize: 1000,
  ttlMs: 5000, // 5 seconds default window
};

let hasherInstance: Awaited<ReturnType<typeof xxhash>> | null = null;

/**
 * Initialize the xxhash hasher (call once at startup)
 */
async function getHasher(): Promise<Awaited<ReturnType<typeof xxhash>>> {
  if (!hasherInstance) {
    hasherInstance = await xxhash();
  }
  return hasherInstance;
}

export class MessageDeduplicator {
  private cache: LRUCache<string, number>;
  private config: Required<DeduplicationConfig>;
  private hasherPromise: Promise<Awaited<ReturnType<typeof xxhash>>>;

  constructor(config: DeduplicationConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.hasherPromise = getHasher();

    this.cache = new LRUCache<string, number>({
      max: this.config.maxSize,
      ttl: this.config.ttlMs,
    });
  }

  /**
   * Generate a hash key for a message
   */
  private async generateKey(chatId: number, content: string): Promise<string> {
    const hasher = await this.hasherPromise;
    const input = `${chatId}:${content}`;
    const hash = hasher.h64(input);
    return hash.toString(16);
  }

  /**
   * Check if a message is a duplicate
   * Returns true if duplicate, false if new
   */
  async isDuplicate(chatId: number, content: string): Promise<boolean> {
    const key = await this.generateKey(chatId, content);
    return this.cache.has(key);
  }

  /**
   * Mark a message as seen (add to cache)
   */
  async markSeen(chatId: number, content: string): Promise<void> {
    const key = await this.generateKey(chatId, content);
    this.cache.set(key, Date.now());
  }

  /**
   * Check and mark in one operation
   * Returns true if duplicate (already seen), false if new (and marks it)
   */
  async checkAndMark(chatId: number, content: string): Promise<boolean> {
    const key = await this.generateKey(chatId, content);

    if (this.cache.has(key)) {
      return true; // Duplicate
    }

    this.cache.set(key, Date.now());
    return false; // New message
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
  } {
    const stats = {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      hitRate: 0,
    };

    // Calculate hit rate if available
    const calculatedSize = this.cache.calculatedSize;
    if (calculatedSize !== undefined && calculatedSize > 0) {
      stats.hitRate = (this.cache.size / calculatedSize) * 100;
    }

    return stats;
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the number of entries in the cache
   */
  get size(): number {
    return this.cache.size;
  }
}

/**
 * Wrapper function to deduplicate messages
 * Returns the original send function wrapped with deduplication
 */
export function withDeduplication<T>(
  deduplicator: MessageDeduplicator,
  sendFn: (chatId: number, content: string, ...args: unknown[]) => Promise<T>
): (chatId: number, content: string, ...args: unknown[]) => Promise<T | null> {
  return async (chatId: number, content: string, ...args: unknown[]): Promise<T | null> => {
    const isDuplicate = await deduplicator.checkAndMark(chatId, content);

    if (isDuplicate) {
      console.debug(`[Deduplicator] Skipping duplicate message for chat ${chatId}`);
      return null;
    }

    return sendFn(chatId, content, ...args);
  };
}
