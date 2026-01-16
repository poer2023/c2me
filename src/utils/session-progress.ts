import { Telegraf } from 'telegraf';
import { ProgressSettings, DEFAULT_PROGRESS_SETTINGS } from './progress-config';
import { TelegramRateLimiter } from './rate-limiter';

/**
 * SessionProgress - Real-time progress tracking for Claude sessions
 *
 * Provides visual feedback to users during long-running Claude operations:
 * - Periodic status message updates with elapsed time
 * - Heartbeat typing indicators
 * - Tool use status display
 * - Rate limit protection with retry_after handling
 */
export class SessionProgress {
  private chatId: number = 0;
  private statusMessageId: number = 0;
  private startTime: number = 0;
  private lastEditTime: number = 0;
  private currentStatus: string = 'Processing';
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private editInterval: NodeJS.Timeout | null = null;
  private bot: Telegraf;
  private isActive: boolean = false;
  private isPaused: boolean = false;
  private pauseUntil: number = 0;
  private settings: ProgressSettings;
  private rateLimiter: TelegramRateLimiter | null = null;

  // Statistics
  private rateLimitErrors: number = 0;
  private lastError: string | null = null;
  private consecutiveErrors: number = 0;

  // Event callbacks
  private onRateLimitCallback: ((retryAfter: number) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;

  constructor(bot: Telegraf, settings?: Partial<ProgressSettings>, rateLimiter?: TelegramRateLimiter) {
    this.bot = bot;
    this.settings = { ...DEFAULT_PROGRESS_SETTINGS, ...settings };
    this.rateLimiter = rateLimiter || null;
  }

  /**
   * Update settings dynamically
   */
  updateSettings(newSettings: Partial<ProgressSettings>): void {
    this.settings = { ...this.settings, ...newSettings };

    // Restart intervals if active
    if (this.isActive && !this.isPaused) {
      this.restartIntervals();
    }
  }

  /**
   * Get current settings
   */
  getSettings(): ProgressSettings {
    return { ...this.settings };
  }

  /**
   * Set rate limit callback
   */
  onRateLimit(callback: (retryAfter: number) => void): void {
    this.onRateLimitCallback = callback;
  }

  /**
   * Set error callback
   */
  onError(callback: (error: string) => void): void {
    this.onErrorCallback = callback;
  }

  /**
   * Start progress tracking
   * @param chatId Telegram chat ID
   * @param messageId Status message ID (the Processing... message)
   */
  async start(chatId: number, messageId: number): Promise<void> {
    if (!this.settings.enabled) return;

    this.chatId = chatId;
    this.statusMessageId = messageId;
    this.startTime = Date.now();
    this.lastEditTime = 0;
    this.currentStatus = 'Processing';
    this.isActive = true;
    this.isPaused = false;
    this.pauseUntil = 0;
    this.consecutiveErrors = 0;

    this.startIntervals();

    // Send first heartbeat immediately
    await this.sendHeartbeat();
    
    // Update status message immediately to show correct initial time (fixes processing(0s) bug)
    await this.updateStatusMessage();
  }

  /**
   * Start all intervals
   */
  private startIntervals(): void {
    // Heartbeat: send typing action
    this.heartbeatInterval = setInterval(() => {
      if (this.isActive && !this.isPaused) {
        this.sendHeartbeat();
      }
    }, this.settings.heartbeatInterval);

    // Status update: edit message periodically
    this.editInterval = setInterval(() => {
      if (this.isActive && !this.isPaused) {
        this.updateStatusMessage();
      }
    }, this.settings.statusUpdateInterval);
  }

  /**
   * Restart intervals (after settings change)
   */
  private restartIntervals(): void {
    this.stopIntervals();
    this.startIntervals();
  }

  /**
   * Stop all intervals
   */
  private stopIntervals(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.editInterval) {
      clearInterval(this.editInterval);
      this.editInterval = null;
    }
  }

  /**
   * Send typing heartbeat
   */
  private async sendHeartbeat(): Promise<void> {
    if (!this.isActive || this.isPaused) return;

    try {
      if (this.rateLimiter) {
        await this.rateLimiter.throttle(this.chatId, async () => {
          await this.bot.telegram.sendChatAction(this.chatId, 'typing');
        });
      } else {
        await this.bot.telegram.sendChatAction(this.chatId, 'typing');
      }
      this.consecutiveErrors = 0;
    } catch (error) {
      this.handleError(error, 'heartbeat');
    }
  }

  /**
   * Update current tool status
   * @param toolName Tool name
   * @param input Tool input parameters
   */
  updateTool(toolName: string, input?: Record<string, unknown>): void {
    if (!this.isActive || !this.settings.enabled) return;

    this.currentStatus = this.formatToolStatus(toolName, input);
    // Update immediately when tool changes (but still throttled)
    this.updateStatusMessage();
  }

  /**
   * Update status message (with throttling and rate limit protection)
   */
  private async updateStatusMessage(): Promise<void> {
    if (!this.isActive || this.isPaused) return;

    const now = Date.now();

    // Check if still paused from rate limit
    if (now < this.pauseUntil) {
      return;
    } else if (this.pauseUntil > 0) {
      // Resume from pause
      this.isPaused = false;
      this.pauseUntil = 0;
    }

    // Throttle: at least minEditInterval between edits
    if (now - this.lastEditTime < this.settings.minEditInterval) return;

    const text = this.buildStatusText();

    try {
      if (this.rateLimiter) {
        await this.rateLimiter.throttle(this.chatId, async () => {
          await this.bot.telegram.editMessageText(
            this.chatId,
            this.statusMessageId,
            undefined,
            text
          );
        });
      } else {
        await this.bot.telegram.editMessageText(
          this.chatId,
          this.statusMessageId,
          undefined,
          text
        );
      }

      this.lastEditTime = now;
      this.consecutiveErrors = 0;
      this.lastError = null;
    } catch (error: unknown) {
      this.handleError(error, 'editMessage');
    }
  }

  /**
   * Build status text based on settings
   */
  private buildStatusText(): string {
    let text = '⏳';

    if (this.settings.showToolDetails) {
      text += ` ${this.currentStatus}`;
    } else {
      text += ' Processing';
    }

    if (this.settings.showElapsedTime) {
      const elapsed = this.formatTime((Date.now() - this.startTime) / 1000);
      text += ` (${elapsed})`;
    }

    return text;
  }

  /**
   * Handle errors with retry_after support
   */
  private handleError(error: unknown, context: string): void {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Ignore "message is not modified" error
    if (errorMessage.includes('message is not modified')) {
      return;
    }

    // Ignore "message can't be edited" error (message was deleted or replaced)
    if (errorMessage.includes('message can\'t be edited') || errorMessage.includes('message to edit not found')) {
      // Silently stop trying to edit this message
      this.isActive = false;
      this.stopIntervals();
      return;
    }

    this.consecutiveErrors++;
    this.lastError = errorMessage;

    // Check for 429 Too Many Requests
    if (errorMessage.includes('429') || errorMessage.includes('Too Many Requests') || errorMessage.includes('FLOOD_WAIT')) {
      this.rateLimitErrors++;

      // Try to extract retry_after
      const retryAfter = this.parseRetryAfter(errorMessage);

      if (this.settings.autoPauseOnRateLimit && retryAfter > 0) {
        this.pauseFor(retryAfter * 1000);

        if (this.onRateLimitCallback) {
          this.onRateLimitCallback(retryAfter);
        }

        console.warn(`[SessionProgress] Rate limited in ${context}. Pausing for ${retryAfter}s`);
      }

      // Dynamic interval adjustment
      if (this.settings.dynamicIntervalAdjustment) {
        this.increaseIntervals();
      }
    } else {
      // For other errors, apply exponential backoff if consecutive
      if (this.consecutiveErrors >= 3) {
        const backoffMs = Math.min(30000, 1000 * Math.pow(2, this.consecutiveErrors - 3));
        this.pauseFor(backoffMs);
        console.warn(`[SessionProgress] ${this.consecutiveErrors} consecutive errors. Backing off for ${backoffMs}ms`);
      }
    }

    if (this.onErrorCallback && this.consecutiveErrors >= 3) {
      this.onErrorCallback(errorMessage);
    }

    // Only log non-trivial errors
    if (!errorMessage.includes('message is not modified')) {
      console.error(`[SessionProgress] Error in ${context}:`, errorMessage);
    }
  }

  /**
   * Parse retry_after from error message
   */
  private parseRetryAfter(errorMessage: string): number {
    // Match patterns like "retry after 30" or "retry_after":30 or FLOOD_WAIT_30
    const patterns = [
      /retry[_\s]?after[:\s]+(\d+)/i,
      /FLOOD_WAIT_(\d+)/i,
      /"retry_after":\s*(\d+)/i,
    ];

    for (const pattern of patterns) {
      const match = errorMessage.match(pattern);
      if (match && match[1]) {
        return parseInt(match[1], 10);
      }
    }

    // Default retry after 30 seconds if 429 but no specific time
    if (errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
      return 30;
    }

    return 0;
  }

  /**
   * Pause progress tracking for specified duration
   */
  pauseFor(durationMs: number): void {
    this.isPaused = true;
    this.pauseUntil = Date.now() + durationMs;

    // Set a timeout to resume
    setTimeout(() => {
      if (this.isActive && this.pauseUntil <= Date.now()) {
        this.isPaused = false;
        this.pauseUntil = 0;
      }
    }, durationMs);
  }

  /**
   * Manually pause progress tracking
   */
  pause(): void {
    this.isPaused = true;
  }

  /**
   * Manually resume progress tracking
   */
  resume(): void {
    this.isPaused = false;
    this.pauseUntil = 0;
  }

  /**
   * Increase intervals dynamically after rate limit
   */
  private increaseIntervals(): void {
    const multiplier = 1.5;
    const maxMultiplier = 3;

    const currentMultiplier = this.settings.minEditInterval / DEFAULT_PROGRESS_SETTINGS.minEditInterval;

    if (currentMultiplier < maxMultiplier) {
      this.settings.minEditInterval = Math.min(
        this.settings.minEditInterval * multiplier,
        DEFAULT_PROGRESS_SETTINGS.minEditInterval * maxMultiplier
      );
      this.settings.statusUpdateInterval = Math.min(
        this.settings.statusUpdateInterval * multiplier,
        DEFAULT_PROGRESS_SETTINGS.statusUpdateInterval * maxMultiplier
      );

      this.restartIntervals();
      console.log(`[SessionProgress] Increased intervals to ${this.settings.minEditInterval}ms / ${this.settings.statusUpdateInterval}ms`);
    }
  }

  /**
   * Format time display
   */
  private formatTime(seconds: number): string {
    const secs = Math.floor(seconds);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins}m ${remainingSecs}s`;
  }

  /**
   * Format tool status display
   */
  private formatToolStatus(tool: string, input?: Record<string, unknown>): string {
    const toolIcons: Record<string, string> = {
      'Read': '📖 Reading',
      'Write': '✍️ Writing',
      'Edit': '✏️ Editing',
      'MultiEdit': '✏️ MultiEdit',
      'Bash': '⚡ Running',
      'Grep': '🔎 Searching',
      'Glob': '🔍 Globbing',
      'LS': '📁 Listing',
      'Task': '🤖 Delegating',
      'TodoWrite': '📝 Managing tasks',
      'WebFetch': '🌐 Fetching',
      'WebSearch': '🔍 Searching web',
      'AskFollowupQuestion': '❓ Asking',
      'AttemptCompletion': '✅ Completing',
    };

    const icon = toolIcons[tool] || '🔧 Processing';

    if (!this.settings.showToolDetails) {
      return icon.split(' ')[0] + ' Processing';
    }

    // Try to extract meaningful target information
    let target = '';
    if (input) {
      if (typeof input.file_path === 'string') {
        target = input.file_path.split('/').pop() || '';
      } else if (typeof input.command === 'string') {
        // Truncate command to first 30 characters
        target = input.command.slice(0, 30);
        if (input.command.length > 30) target += '...';
      } else if (typeof input.pattern === 'string') {
        target = `"${input.pattern}"`;
      } else if (typeof input.description === 'string') {
        target = input.description;
      }
    }

    return target ? `${icon} ${target}` : icon;
  }

  /**
   * Complete progress tracking
   * @param success Whether completed successfully
   */
  async complete(success: boolean = true): Promise<void> {
    this.isActive = false;
    this.stopIntervals();

    if (!this.settings.enabled) return;

    // Update final status
    const elapsed = this.formatTime((Date.now() - this.startTime) / 1000);
    const text = success
      ? `✅ Completed (${elapsed})`
      : `❌ Failed (${elapsed})`;

    try {
      if (this.rateLimiter) {
        await this.rateLimiter.throttle(this.chatId, async () => {
          await this.bot.telegram.editMessageText(
            this.chatId,
            this.statusMessageId,
            undefined,
            text
          );
        });
      } else {
        await this.bot.telegram.editMessageText(
          this.chatId,
          this.statusMessageId,
          undefined,
          text
        );
      }
    } catch (error) {
      console.error('Failed to update completion status:', error);
    }
  }

  /**
   * Abort progress tracking (without updating message)
   */
  abort(): void {
    this.isActive = false;
    this.stopIntervals();
  }

  /**
   * Check if active
   */
  get active(): boolean {
    return this.isActive;
  }

  /**
   * Check if paused
   */
  get paused(): boolean {
    return this.isPaused;
  }

  /**
   * Get pause until timestamp
   */
  get pauseUntilTime(): number {
    return this.pauseUntil;
  }

  /**
   * Get elapsed time (milliseconds)
   */
  get elapsedMs(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get rate limit error count
   */
  get rateLimitErrorCount(): number {
    return this.rateLimitErrors;
  }

  /**
   * Get last error message
   */
  get lastErrorMessage(): string | null {
    return this.lastError;
  }

  /**
   * Get statistics
   */
  getStats(): {
    rateLimitErrors: number;
    consecutiveErrors: number;
    lastError: string | null;
    isPaused: boolean;
    pauseUntil: number;
    elapsedMs: number;
  } {
    return {
      rateLimitErrors: this.rateLimitErrors,
      consecutiveErrors: this.consecutiveErrors,
      lastError: this.lastError,
      isPaused: this.isPaused,
      pauseUntil: this.pauseUntil,
      elapsedMs: this.elapsedMs,
    };
  }
}
