import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  TelegramRateLimiter,
  getDefaultRateLimiter,
  resetDefaultRateLimiter,
} from '../../../src/utils/rate-limiter';

describe('TelegramRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetDefaultRateLimiter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should use default config values', () => {
      const limiter = new TelegramRateLimiter();
      const stats = limiter.getStats();

      expect(stats.config.maxRequestsPerSecond).toBe(30);
      expect(stats.config.maxRequestsPerMinutePerChat).toBe(20);
      expect(stats.config.burstSize).toBe(5);
    });

    it('should accept custom config', () => {
      const limiter = new TelegramRateLimiter({
        maxRequestsPerSecond: 10,
        maxRequestsPerMinutePerChat: 5,
        burstSize: 2,
      });
      const stats = limiter.getStats();

      expect(stats.config.maxRequestsPerSecond).toBe(10);
      expect(stats.config.maxRequestsPerMinutePerChat).toBe(5);
      expect(stats.config.burstSize).toBe(2);
    });
  });

  describe('token management', () => {
    it('should start with full global tokens', () => {
      const limiter = new TelegramRateLimiter({ maxRequestsPerSecond: 10 });
      expect(limiter.globalTokens).toBe(10);
    });

    it('should start with full chat tokens for new chats', () => {
      const limiter = new TelegramRateLimiter({ maxRequestsPerMinutePerChat: 15 });
      expect(limiter.getChatTokens(123)).toBe(15);
    });
  });

  describe('throttle', () => {
    it('should execute function immediately when tokens available', async () => {
      const limiter = new TelegramRateLimiter();
      const fn = vi.fn().mockResolvedValue('result');

      const result = await limiter.throttle(123, fn);

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledOnce();
    });

    it('should consume tokens on each call', async () => {
      const limiter = new TelegramRateLimiter({
        maxRequestsPerSecond: 5,
        maxRequestsPerMinutePerChat: 10,
      });

      const initialGlobal = limiter.globalTokens;
      const initialChat = limiter.getChatTokens(123);

      await limiter.throttle(123, async () => 'test');

      expect(limiter.globalTokens).toBe(initialGlobal - 1);
      expect(limiter.getChatTokens(123)).toBe(initialChat - 1);
    });
  });

  describe('bucket cleanup', () => {
    it('should remove old chat buckets', () => {
      const limiter = new TelegramRateLimiter();

      // Access multiple chats
      limiter.getChatTokens(1);
      limiter.getChatTokens(2);
      limiter.getChatTokens(3);

      expect(limiter.getStats().activeChatBuckets).toBe(3);

      // Advance time past max age
      vi.advanceTimersByTime(4000000); // > 1 hour

      limiter.cleanupOldBuckets();

      expect(limiter.getStats().activeChatBuckets).toBe(0);
    });

    it('should keep recent chat buckets', () => {
      const limiter = new TelegramRateLimiter();

      limiter.getChatTokens(1);

      vi.advanceTimersByTime(1000); // 1 second

      limiter.cleanupOldBuckets();

      expect(limiter.getStats().activeChatBuckets).toBe(1);
    });
  });

  describe('singleton', () => {
    it('should return same instance from getDefaultRateLimiter', () => {
      const limiter1 = getDefaultRateLimiter();
      const limiter2 = getDefaultRateLimiter();

      expect(limiter1).toBe(limiter2);
    });

    it('should create new instance after reset', () => {
      const limiter1 = getDefaultRateLimiter();
      resetDefaultRateLimiter();
      const limiter2 = getDefaultRateLimiter();

      expect(limiter1).not.toBe(limiter2);
    });
  });

  describe('stats', () => {
    it('should report correct statistics', () => {
      const limiter = new TelegramRateLimiter({
        maxRequestsPerSecond: 20,
        maxRequestsPerMinutePerChat: 15,
        burstSize: 3,
      });

      // Access some chats
      limiter.getChatTokens(1);
      limiter.getChatTokens(2);

      const stats = limiter.getStats();

      expect(stats.globalTokens).toBe(20);
      expect(stats.activeChatBuckets).toBe(2);
      expect(stats.config.maxRequestsPerSecond).toBe(20);
      expect(stats.config.maxRequestsPerMinutePerChat).toBe(15);
      expect(stats.config.burstSize).toBe(3);
    });
  });
});
