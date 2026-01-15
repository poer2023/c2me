export interface AsyncQueueOptions {
  /** Maximum queue size (default: 1000) */
  maxSize?: number;
  /** Policy when queue is full: 'oldest' drops oldest, 'newest' drops incoming, 'reject' throws error */
  dropPolicy?: 'oldest' | 'newest' | 'reject';
}

export class AsyncQueue<T> {
  private queue: T[] = [];
  private resolvers: ((value: T) => void)[] = [];
  private rejectors: ((error: Error) => void)[] = [];
  private closed = false;
  private readonly maxSize: number;
  private readonly dropPolicy: 'oldest' | 'newest' | 'reject';
  private droppedCount = 0;

  constructor(options: AsyncQueueOptions = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.dropPolicy = options.dropPolicy ?? 'oldest';
  }

  /**
   * Enqueue an item. Returns true if successful, false if dropped (when dropPolicy is 'newest').
   * @throws Error if queue is closed or full (when dropPolicy is 'reject')
   */
  enqueue(item: T): boolean {
    if (this.closed) {
      throw new Error('Queue is closed');
    }

    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      this.rejectors.shift();
      resolve(item);
      return true;
    }

    // Check queue bounds
    if (this.queue.length >= this.maxSize) {
      switch (this.dropPolicy) {
        case 'oldest':
          this.queue.shift();
          this.droppedCount++;
          break;
        case 'newest':
          this.droppedCount++;
          return false;
        case 'reject':
          throw new Error(`Queue full (max: ${this.maxSize})`);
      }
    }

    this.queue.push(item);
    return true;
  }

  async dequeue(): Promise<T> {
    if (this.closed && this.queue.length === 0) {
      throw new Error('Queue is closed and empty');
    }

    return new Promise((resolve, reject) => {
      if (this.queue.length > 0) {
        resolve(this.queue.shift()!);
      } else if (this.closed) {
        reject(new Error('Queue is closed and empty'));
      } else {
        this.resolvers.push(resolve);
        this.rejectors.push(reject);
      }
    });
  }

  clear(): void {
    this.queue.length = 0;
    
    // Reject all pending resolvers
    while (this.rejectors.length > 0) {
      const reject = this.rejectors.shift()!;
      reject(new Error('Queue cleared'));
    }
    this.resolvers.length = 0;
  }

  close(): void {
    this.closed = true;
    
    // Reject all pending resolvers
    while (this.rejectors.length > 0) {
      const reject = this.rejectors.shift()!;
      reject(new Error('Queue is closed'));
    }
    this.resolvers.length = 0;
  }

  get size(): number {
    return this.queue.length;
  }

  get pendingResolvers(): number {
    return this.resolvers.length;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Queue utilization as percentage (0-1) */
  get utilization(): number {
    return this.queue.length / this.maxSize;
  }

  /** Number of items dropped due to queue bounds */
  get dropped(): number {
    return this.droppedCount;
  }

  /** Maximum queue capacity */
  get capacity(): number {
    return this.maxSize;
  }
}