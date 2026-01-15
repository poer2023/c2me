/**
 * Priority Message Queue
 *
 * BullMQ-based priority queue for Telegram message delivery.
 * Supports 3 priority levels:
 * - Priority 1 (Critical): Error notifications, permission requests, session timeouts
 * - Priority 2 (High): Button click responses, command confirmations
 * - Priority 3 (Normal): Claude responses, status updates
 */

import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { incrementCounter } from '../utils/metrics';

export enum MessagePriority {
  Critical = 1,  // Errors, permissions, timeouts
  High = 2,      // User interactions
  Normal = 3,    // Claude responses
}

export interface QueuedMessage {
  chatId: number;
  content: string;
  options?: Record<string, unknown> | undefined;
  priority: MessagePriority;
  timestamp: number;
  retryCount?: number | undefined;
}

export interface PriorityQueueConfig {
  redisUrl?: string;
  maxRetries?: number;
  retryDelay?: number;  // Base delay in ms
  concurrency?: number;
}

const DEFAULT_CONFIG: Required<PriorityQueueConfig> = {
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  maxRetries: 3,
  retryDelay: 1000,
  concurrency: 5,
};

export class PriorityMessageQueue {
  private queue: Queue<QueuedMessage>;
  private worker: Worker<QueuedMessage> | null = null;
  private queueEvents: QueueEvents;
  private config: Required<PriorityQueueConfig>;
  private sendMessageCallback: (chatId: number, content: string, options?: Record<string, unknown>) => Promise<void>;
  private isShutdown = false;

  constructor(
    sendMessageCallback: (chatId: number, content: string, options?: Record<string, unknown>) => Promise<void>,
    config: PriorityQueueConfig = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sendMessageCallback = sendMessageCallback;

    // Parse Redis URL for connection options
    const redisConnection = this.parseRedisUrl(this.config.redisUrl);

    // Create queue
    this.queue = new Queue<QueuedMessage>('telegram-messages', {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: this.config.maxRetries,
        backoff: {
          type: 'exponential',
          delay: this.config.retryDelay,
        },
        removeOnComplete: 100,  // Keep last 100 completed jobs
        removeOnFail: 50,       // Keep last 50 failed jobs
      },
    });

    // Create queue events for monitoring
    this.queueEvents = new QueueEvents('telegram-messages', {
      connection: redisConnection,
    });

    this.setupEventListeners();
  }

  /**
   * Parse Redis URL into connection options
   */
  private parseRedisUrl(url: string): { host: string; port: number; password?: string } {
    try {
      const parsed = new URL(url);
      const result: { host: string; port: number; password?: string } = {
        host: parsed.hostname || 'localhost',
        port: parseInt(parsed.port) || 6379,
      };
      if (parsed.password) {
        result.password = parsed.password;
      }
      return result;
    } catch {
      return { host: 'localhost', port: 6379 };
    }
  }

  /**
   * Set up event listeners for monitoring
   */
  private setupEventListeners(): void {
    this.queueEvents.on('completed', ({ jobId }) => {
      console.debug(`[PriorityQueue] Job ${jobId} completed`);
    });

    this.queueEvents.on('failed', ({ jobId, failedReason }) => {
      console.error(`[PriorityQueue] Job ${jobId} failed: ${failedReason}`);
      incrementCounter('errors');
    });

    this.queueEvents.on('retries-exhausted', ({ jobId }) => {
      console.error(`[PriorityQueue] Job ${jobId} exhausted all retries`);
    });
  }

  /**
   * Start the worker to process messages
   */
  start(): void {
    if (this.worker) {
      console.warn('[PriorityQueue] Worker already started');
      return;
    }

    const redisConnection = this.parseRedisUrl(this.config.redisUrl);

    this.worker = new Worker<QueuedMessage>(
      'telegram-messages',
      async (job: Job<QueuedMessage>) => {
        const { chatId, content, options } = job.data;

        try {
          await this.sendMessageCallback(chatId, content, options);
          incrementCounter('messages_sent');
        } catch (error) {
          console.error(`[PriorityQueue] Failed to send message:`, error);
          throw error; // Rethrow to trigger retry
        }
      },
      {
        connection: redisConnection,
        concurrency: this.config.concurrency,
      }
    );

    this.worker.on('error', (error) => {
      console.error('[PriorityQueue] Worker error:', error);
    });

    console.log('[PriorityQueue] Worker started');
  }

  /**
   * Add a message to the queue with priority
   */
  async enqueue(
    chatId: number,
    content: string,
    priority: MessagePriority = MessagePriority.Normal,
    options?: Record<string, unknown>
  ): Promise<string> {
    if (this.isShutdown) {
      throw new Error('Queue is shutdown');
    }

    const job = await this.queue.add(
      'send-message',
      {
        chatId,
        content,
        options,
        priority,
        timestamp: Date.now(),
      },
      {
        priority, // BullMQ uses lower number = higher priority
      }
    );

    return job.id || 'unknown';
  }

  /**
   * Add a critical message (highest priority)
   */
  async enqueueCritical(
    chatId: number,
    content: string,
    options?: Record<string, unknown>
  ): Promise<string> {
    return this.enqueue(chatId, content, MessagePriority.Critical, options);
  }

  /**
   * Add a high priority message
   */
  async enqueueHigh(
    chatId: number,
    content: string,
    options?: Record<string, unknown>
  ): Promise<string> {
    return this.enqueue(chatId, content, MessagePriority.High, options);
  }

  /**
   * Add a normal priority message
   */
  async enqueueNormal(
    chatId: number,
    content: string,
    options?: Record<string, unknown>
  ): Promise<string> {
    return this.enqueue(chatId, content, MessagePriority.Normal, options);
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * Pause the queue
   */
  async pause(): Promise<void> {
    await this.queue.pause();
    console.log('[PriorityQueue] Queue paused');
  }

  /**
   * Resume the queue
   */
  async resume(): Promise<void> {
    await this.queue.resume();
    console.log('[PriorityQueue] Queue resumed');
  }

  /**
   * Drain the queue (remove all waiting jobs)
   */
  async drain(): Promise<void> {
    await this.queue.drain();
    console.log('[PriorityQueue] Queue drained');
  }

  /**
   * Shutdown the queue and worker
   */
  async shutdown(): Promise<void> {
    this.isShutdown = true;

    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }

    await this.queueEvents.close();
    await this.queue.close();

    console.log('[PriorityQueue] Shutdown complete');
  }
}
