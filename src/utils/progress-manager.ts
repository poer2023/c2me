import { Telegraf } from 'telegraf';
import { SessionProgress } from './session-progress';

/**
 * ProgressManager - Manages progress tracking instances for multiple chats
 *
 * Provides centralized management for SessionProgress instances across
 * different chat sessions, ensuring proper cleanup and isolation.
 */
export class ProgressManager {
  private bot: Telegraf;
  private progressMap: Map<number, SessionProgress> = new Map();

  constructor(bot: Telegraf) {
    this.bot = bot;
  }

  /**
   * Start progress tracking for specified chat
   */
  async startProgress(chatId: number, messageId: number): Promise<SessionProgress> {
    // If progress tracking already exists, abort it first
    const existing = this.progressMap.get(chatId);
    if (existing) {
      existing.abort();
    }

    const progress = new SessionProgress(this.bot);
    await progress.start(chatId, messageId);
    this.progressMap.set(chatId, progress);

    return progress;
  }

  /**
   * Get progress tracking instance for specified chat
   */
  getProgress(chatId: number): SessionProgress | undefined {
    return this.progressMap.get(chatId);
  }

  /**
   * Update tool status
   */
  updateTool(chatId: number, toolName: string, input?: Record<string, unknown>): void {
    const progress = this.progressMap.get(chatId);
    if (progress?.active) {
      progress.updateTool(toolName, input);
    }
  }

  /**
   * Complete progress tracking
   */
  async completeProgress(chatId: number, success: boolean = true): Promise<void> {
    const progress = this.progressMap.get(chatId);
    if (progress) {
      await progress.complete(success);
      this.progressMap.delete(chatId);
    }
  }

  /**
   * Abort progress tracking
   */
  abortProgress(chatId: number): void {
    const progress = this.progressMap.get(chatId);
    if (progress) {
      progress.abort();
      this.progressMap.delete(chatId);
    }
  }

  /**
   * Cleanup all progress tracking
   */
  cleanup(): void {
    for (const progress of this.progressMap.values()) {
      progress.abort();
    }
    this.progressMap.clear();
  }
}
