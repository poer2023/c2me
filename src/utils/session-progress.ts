import { Telegraf } from 'telegraf';

/**
 * SessionProgress - Real-time progress tracking for Claude sessions
 *
 * Provides visual feedback to users during long-running Claude operations:
 * - Periodic status message updates with elapsed time
 * - Heartbeat typing indicators
 * - Tool use status display
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

  // API limits: 30 req/s global, 20 req/min per user
  // Safe threshold: edit at least every 3 seconds
  private readonly MIN_EDIT_INTERVAL = 3000;
  private readonly HEARTBEAT_INTERVAL = 4000;
  private readonly STATUS_UPDATE_INTERVAL = 5000;

  constructor(bot: Telegraf) {
    this.bot = bot;
  }

  /**
   * Start progress tracking
   * @param chatId Telegram chat ID
   * @param messageId Status message ID (the Processing... message)
   */
  async start(chatId: number, messageId: number): Promise<void> {
    this.chatId = chatId;
    this.statusMessageId = messageId;
    this.startTime = Date.now();
    this.lastEditTime = 0;
    this.currentStatus = 'Processing';
    this.isActive = true;

    // Heartbeat: send typing action every 4 seconds (doesn't count towards message quota)
    this.heartbeatInterval = setInterval(() => {
      if (this.isActive) {
        this.bot.telegram.sendChatAction(chatId, 'typing').catch(() => {});
      }
    }, this.HEARTBEAT_INTERVAL);

    // Status update: edit message every 5 seconds
    this.editInterval = setInterval(() => {
      if (this.isActive) {
        this.updateStatusMessage();
      }
    }, this.STATUS_UPDATE_INTERVAL);

    // Send first heartbeat immediately
    await this.bot.telegram.sendChatAction(chatId, 'typing').catch(() => {});
  }

  /**
   * Update current tool status
   * @param toolName Tool name
   * @param input Tool input parameters
   */
  updateTool(toolName: string, input?: Record<string, unknown>): void {
    if (!this.isActive) return;

    this.currentStatus = this.formatToolStatus(toolName, input);
    // Update immediately when tool changes (but still throttled)
    this.updateStatusMessage();
  }

  /**
   * Update status message (with throttling)
   */
  private async updateStatusMessage(): Promise<void> {
    if (!this.isActive) return;

    const now = Date.now();
    // Throttle: at least MIN_EDIT_INTERVAL between edits
    if (now - this.lastEditTime < this.MIN_EDIT_INTERVAL) return;

    const elapsed = this.formatTime((now - this.startTime) / 1000);
    const text = `⏳ ${this.currentStatus} (${elapsed})`;

    try {
      await this.bot.telegram.editMessageText(
        this.chatId,
        this.statusMessageId,
        undefined,
        text
      );
      this.lastEditTime = now;
    } catch (error: unknown) {
      // Ignore "message is not modified" error
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('message is not modified')) {
        console.error('Failed to update status message:', error);
      }
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
    };

    const icon = toolIcons[tool] || '🔧 Processing';

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

    // Clear timers
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.editInterval) {
      clearInterval(this.editInterval);
      this.editInterval = null;
    }

    // Update final status
    const elapsed = this.formatTime((Date.now() - this.startTime) / 1000);
    const text = success
      ? `✅ Completed (${elapsed})`
      : `❌ Failed (${elapsed})`;

    try {
      await this.bot.telegram.editMessageText(
        this.chatId,
        this.statusMessageId,
        undefined,
        text
      );
    } catch (error) {
      console.error('Failed to update completion status:', error);
    }
  }

  /**
   * Abort progress tracking (without updating message)
   */
  abort(): void {
    this.isActive = false;

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
   * Check if active
   */
  get active(): boolean {
    return this.isActive;
  }

  /**
   * Get elapsed time (milliseconds)
   */
  get elapsedMs(): number {
    return Date.now() - this.startTime;
  }
}
