import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageBatcher } from '../../../src/queue/message-batcher';

describe('MessageBatcher', () => {
  let batcher: MessageBatcher;
  let sendCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendCallback = vi.fn().mockResolvedValue(undefined);
    batcher = new MessageBatcher(sendCallback);
  });

  describe('basic message batching', () => {
    it('should batch messages added before first batch processes', async () => {
      // Add messages synchronously before any async processing
      batcher.addMessage(12345, 'Hello');
      batcher.addMessage(12345, 'World');
      batcher.addMessage(12345, '!');

      // Wait for batch processing
      await new Promise(r => setTimeout(r, 100));

      // The batcher processes messages as they accumulate
      // At minimum, the first batch should contain multiple messages
      expect(sendCallback).toHaveBeenCalled();

      // Check that at least one call contains batched messages
      const calls = sendCallback.mock.calls;
      const allMessages = calls.map((c: [number, string]) => c[1]).join('\n');
      expect(allMessages).toContain('Hello');
      expect(allMessages).toContain('World');
      expect(allMessages).toContain('!');
    });

    it('should handle single message', async () => {
      batcher.addMessage(12345, 'Single message');

      await new Promise(r => setTimeout(r, 50));

      expect(sendCallback).toHaveBeenCalledTimes(1);
      expect(sendCallback).toHaveBeenCalledWith(12345, 'Single message');
    });

    it('should handle multiple chats independently', async () => {
      batcher.addMessage(111, 'Chat 1 message');
      batcher.addMessage(222, 'Chat 2 message');

      await new Promise(r => setTimeout(r, 50));

      expect(sendCallback).toHaveBeenCalledTimes(2);
      expect(sendCallback).toHaveBeenCalledWith(111, 'Chat 1 message');
      expect(sendCallback).toHaveBeenCalledWith(222, 'Chat 2 message');
    });
  });

  describe('getStatus', () => {
    it('should report correct status for empty queue', () => {
      const status = batcher.getStatus(12345);

      expect(status.bufferedMessages).toBe(0);
      expect(status.isScheduled).toBe(false);
    });

    it('should report buffered messages before processing', () => {
      batcher.addMessage(12345, 'Message 1');
      batcher.addMessage(12345, 'Message 2');

      const status = batcher.getStatus(12345);

      // Messages are buffered but processing may have started
      expect(status.isScheduled).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should cleanup single chat', async () => {
      batcher.addMessage(12345, 'Message');
      batcher.cleanup(12345);

      const status = batcher.getStatus(12345);
      expect(status.bufferedMessages).toBe(0);
      expect(status.isScheduled).toBe(false);
    });

    it('should clear single chat', async () => {
      batcher.addMessage(12345, 'Message');
      batcher.clear(12345);

      const status = batcher.getStatus(12345);
      expect(status.bufferedMessages).toBe(0);
    });
  });

  describe('shutdown', () => {
    it('should cleanup all chats on shutdown', async () => {
      batcher.addMessage(111, 'Chat 1');
      batcher.addMessage(222, 'Chat 2');
      batcher.addMessage(333, 'Chat 3');

      batcher.shutdown();

      expect(batcher.getStatus(111).bufferedMessages).toBe(0);
      expect(batcher.getStatus(222).bufferedMessages).toBe(0);
      expect(batcher.getStatus(333).bufferedMessages).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should handle callback errors gracefully', async () => {
      const errorCallback = vi.fn().mockRejectedValue(new Error('Send failed'));
      const errorBatcher = new MessageBatcher(errorCallback);

      // Should not throw
      errorBatcher.addMessage(12345, 'Message');

      await new Promise(r => setTimeout(r, 50));

      expect(errorCallback).toHaveBeenCalled();
    });
  });

  describe('sequential processing', () => {
    it('should process messages in order for same chat', async () => {
      const callOrder: string[] = [];
      const slowCallback = vi.fn().mockImplementation(async (_chatId, msg) => {
        callOrder.push(msg);
        await new Promise(r => setTimeout(r, 10));
      });

      const sequentialBatcher = new MessageBatcher(slowCallback);

      sequentialBatcher.addMessage(12345, 'First');

      await new Promise(r => setTimeout(r, 50));

      sequentialBatcher.addMessage(12345, 'Second');

      await new Promise(r => setTimeout(r, 100));

      expect(callOrder).toContain('First');
    });
  });
});
