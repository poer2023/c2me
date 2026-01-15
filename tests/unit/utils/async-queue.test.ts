import { describe, it, expect, beforeEach } from 'vitest';
import { AsyncQueue, AsyncQueueOptions } from '../../../src/utils/async-queue';

describe('AsyncQueue', () => {
  describe('basic operations', () => {
    it('should enqueue and dequeue items in FIFO order', async () => {
      const queue = new AsyncQueue<number>();

      queue.enqueue(1);
      queue.enqueue(2);
      queue.enqueue(3);

      expect(await queue.dequeue()).toBe(1);
      expect(await queue.dequeue()).toBe(2);
      expect(await queue.dequeue()).toBe(3);
    });

    it('should report correct size', () => {
      const queue = new AsyncQueue<string>();

      expect(queue.size).toBe(0);

      queue.enqueue('a');
      expect(queue.size).toBe(1);

      queue.enqueue('b');
      expect(queue.size).toBe(2);
    });

    it('should handle async dequeue when queue is empty', async () => {
      const queue = new AsyncQueue<number>();

      // Start dequeue before enqueue
      const dequeuePromise = queue.dequeue();

      // Enqueue after a delay
      setTimeout(() => queue.enqueue(42), 10);

      const result = await dequeuePromise;
      expect(result).toBe(42);
    });
  });

  describe('bounded queue with maxSize', () => {
    it('should respect maxSize with oldest drop policy', () => {
      const queue = new AsyncQueue<number>({ maxSize: 3, dropPolicy: 'oldest' });

      queue.enqueue(1);
      queue.enqueue(2);
      queue.enqueue(3);
      queue.enqueue(4); // Should drop 1

      expect(queue.size).toBe(3);
      expect(queue.dropped).toBe(1);
    });

    it('should reject incoming items with newest drop policy', () => {
      const queue = new AsyncQueue<number>({ maxSize: 3, dropPolicy: 'newest' });

      expect(queue.enqueue(1)).toBe(true);
      expect(queue.enqueue(2)).toBe(true);
      expect(queue.enqueue(3)).toBe(true);
      expect(queue.enqueue(4)).toBe(false); // Should be rejected

      expect(queue.size).toBe(3);
      expect(queue.dropped).toBe(1);
    });

    it('should throw error with reject drop policy', () => {
      const queue = new AsyncQueue<number>({ maxSize: 2, dropPolicy: 'reject' });

      queue.enqueue(1);
      queue.enqueue(2);

      expect(() => queue.enqueue(3)).toThrow('Queue full (max: 2)');
    });

    it('should report utilization correctly', () => {
      const queue = new AsyncQueue<number>({ maxSize: 10 });

      expect(queue.utilization).toBe(0);

      queue.enqueue(1);
      queue.enqueue(2);
      queue.enqueue(3);

      expect(queue.utilization).toBe(0.3);
    });

    it('should report capacity', () => {
      const queue = new AsyncQueue<number>({ maxSize: 50 });
      expect(queue.capacity).toBe(50);
    });
  });

  describe('queue closing', () => {
    it('should throw when enqueueing to closed queue', () => {
      const queue = new AsyncQueue<number>();

      queue.close();

      expect(() => queue.enqueue(1)).toThrow('Queue is closed');
      expect(queue.isClosed).toBe(true);
    });

    it('should reject pending dequeue promises when closed', async () => {
      const queue = new AsyncQueue<number>();

      const dequeuePromise = queue.dequeue();
      queue.close();

      await expect(dequeuePromise).rejects.toThrow('Queue is closed');
    });

    it('should allow dequeue of existing items after close', async () => {
      const queue = new AsyncQueue<number>();

      queue.enqueue(1);
      queue.enqueue(2);
      queue.close();

      expect(await queue.dequeue()).toBe(1);
      expect(await queue.dequeue()).toBe(2);
    });
  });

  describe('queue clearing', () => {
    it('should clear all items', () => {
      const queue = new AsyncQueue<number>();

      queue.enqueue(1);
      queue.enqueue(2);
      queue.enqueue(3);

      queue.clear();

      expect(queue.size).toBe(0);
    });

    it('should reject pending dequeue promises when cleared', async () => {
      const queue = new AsyncQueue<number>();

      const dequeuePromise = queue.dequeue();
      queue.clear();

      await expect(dequeuePromise).rejects.toThrow('Queue cleared');
    });
  });

  describe('default options', () => {
    it('should use default maxSize of 1000', () => {
      const queue = new AsyncQueue<number>();
      expect(queue.capacity).toBe(1000);
    });

    it('should use oldest drop policy by default', async () => {
      const queue = new AsyncQueue<number>({ maxSize: 2 });

      queue.enqueue(1);
      queue.enqueue(2);
      queue.enqueue(3); // Should drop 1

      expect(await queue.dequeue()).toBe(2);
      expect(await queue.dequeue()).toBe(3);
    });
  });
});
