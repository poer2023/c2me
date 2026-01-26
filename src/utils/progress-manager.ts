import { Telegraf } from 'telegraf';
import { SessionProgress } from './session-progress';
import {
  ProgressSettings,
  ProgressStats,
  validateSettings,
  formatSettingsDisplay,
  formatStatsDisplay,
  getPreset,
} from './progress-config';
import { TelegramRateLimiter, getDefaultRateLimiter } from './rate-limiter';

/**
 * ProgressManager - Manages progress tracking instances for multiple chats
 *
 * Provides centralized management for SessionProgress instances across
 * different chat sessions, with global configuration and statistics.
 */
export class ProgressManager {
  private bot: Telegraf;
  private progressMap: Map<number, SessionProgress> = new Map();
  private globalSettings: ProgressSettings;
  private rateLimiter: TelegramRateLimiter;

  // Global statistics
  private stats: {
    totalSessions: number;
    successfulCompletions: number;
    failedCompletions: number;
    totalRateLimitErrors: number;
    sessionDurations: number[];
  } = {
    totalSessions: 0,
    successfulCompletions: 0,
    failedCompletions: 0,
    totalRateLimitErrors: 0,
    sessionDurations: [],
  };

  // Per-user settings override
  private userSettings: Map<number, Partial<ProgressSettings>> = new Map();

  // Rate limit callback
  private onGlobalRateLimitCallback: ((chatId: number, retryAfter: number) => void) | null = null;

  constructor(bot: Telegraf, settings?: Partial<ProgressSettings>) {
    this.bot = bot;
    this.globalSettings = validateSettings(settings || {});
    this.rateLimiter = getDefaultRateLimiter();
  }

  /**
   * Set global rate limit callback
   */
  onGlobalRateLimit(callback: (chatId: number, retryAfter: number) => void): void {
    this.onGlobalRateLimitCallback = callback;
  }

  /**
   * Get global settings
   */
  getGlobalSettings(): ProgressSettings {
    return { ...this.globalSettings };
  }

  /**
   * Update global settings
   */
  updateGlobalSettings(newSettings: Partial<ProgressSettings>): void {
    this.globalSettings = validateSettings({ ...this.globalSettings, ...newSettings });

    // Update all active progress instances
    for (const progress of this.progressMap.values()) {
      if (progress.active) {
        progress.updateSettings(this.globalSettings);
      }
    }
  }

  /**
   * Apply a preset configuration
   */
  applyPreset(preset: 'safe' | 'balanced' | 'aggressive'): void {
    this.updateGlobalSettings(getPreset(preset));
  }

  /**
   * Get user-specific settings (merged with global)
   */
  getUserSettings(chatId: number): ProgressSettings {
    const userOverride = this.userSettings.get(chatId) || {};
    return { ...this.globalSettings, ...userOverride };
  }

  /**
   * Set user-specific settings override
   */
  setUserSettings(chatId: number, settings: Partial<ProgressSettings>): void {
    const current = this.userSettings.get(chatId) || {};
    this.userSettings.set(chatId, validateSettings({ ...current, ...settings }));

    // Update active progress if exists
    const progress = this.progressMap.get(chatId);
    if (progress?.active) {
      progress.updateSettings(this.getUserSettings(chatId));
    }
  }

  /**
   * Clear user-specific settings
   */
  clearUserSettings(chatId: number): void {
    this.userSettings.delete(chatId);
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

    const settings = this.getUserSettings(chatId);
    const progress = new SessionProgress(this.bot, settings, this.rateLimiter);

    // Set up rate limit callback
    progress.onRateLimit((retryAfter) => {
      this.stats.totalRateLimitErrors++;
      if (this.onGlobalRateLimitCallback) {
        this.onGlobalRateLimitCallback(chatId, retryAfter);
      }
    });

    await progress.start(chatId, messageId);
    this.progressMap.set(chatId, progress);
    this.stats.totalSessions++;

    return progress;
  }

  /**
   * Get progress tracking instance for specified chat
   */
  getProgress(chatId: number): SessionProgress | undefined {
    return this.progressMap.get(chatId);
  }

  getStatusMessageId(chatId: number): number | null {
    const progress = this.progressMap.get(chatId);
    if (!progress) {
      return null;
    }
    return progress.getStatusMessageId();
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
   * Pause progress for a specific chat
   */
  pauseProgress(chatId: number): void {
    const progress = this.progressMap.get(chatId);
    if (progress?.active) {
      progress.pause();
    }
  }

  /**
   * Resume progress for a specific chat
   */
  resumeProgress(chatId: number): void {
    const progress = this.progressMap.get(chatId);
    if (progress?.active) {
      progress.resume();
    }
  }

  /**
   * Complete progress tracking
   */
  async completeProgress(chatId: number, success: boolean = true): Promise<void> {
    const progress = this.progressMap.get(chatId);
    if (progress) {
      // Record duration
      if (progress.elapsedMs > 0) {
        this.stats.sessionDurations.push(progress.elapsedMs);
        // Keep only last 100 durations
        if (this.stats.sessionDurations.length > 100) {
          this.stats.sessionDurations.shift();
        }
      }

      // Update completion stats
      if (success) {
        this.stats.successfulCompletions++;
      } else {
        this.stats.failedCompletions++;
      }

      // Accumulate rate limit errors
      this.stats.totalRateLimitErrors += progress.rateLimitErrorCount;

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
   * Get comprehensive statistics
   */
  getStats(): ProgressStats {
    let activeSessions = 0;
    let isPaused = false;
    let pauseUntil: number | null = null;
    let lastError: string | null = null;

    for (const progress of this.progressMap.values()) {
      if (progress.active) {
        activeSessions++;
        if (progress.paused) {
          isPaused = true;
          if (progress.pauseUntilTime > (pauseUntil || 0)) {
            pauseUntil = progress.pauseUntilTime;
          }
        }
        if (progress.lastErrorMessage) {
          lastError = progress.lastErrorMessage;
        }
      }
    }

    const avgDuration = this.stats.sessionDurations.length > 0
      ? this.stats.sessionDurations.reduce((a, b) => a + b, 0) / this.stats.sessionDurations.length
      : 0;

    return {
      totalSessions: this.stats.totalSessions,
      activeSessions,
      rateLimitErrors: this.stats.totalRateLimitErrors,
      successfulCompletions: this.stats.successfulCompletions,
      failedCompletions: this.stats.failedCompletions,
      isPaused,
      pauseUntil,
      lastError,
      avgSessionDuration: avgDuration,
    };
  }

  /**
   * Get rate limiter statistics
   */
  getRateLimiterStats(): {
    globalTokens: number;
    activeChatBuckets: number;
    config: { maxRequestsPerSecond: number; maxRequestsPerMinutePerChat: number; burstSize: number };
  } {
    return this.rateLimiter.getStats();
  }

  /**
   * Format settings for display
   */
  formatSettings(chatId?: number): string {
    const settings = chatId ? this.getUserSettings(chatId) : this.globalSettings;
    return formatSettingsDisplay(settings);
  }

  /**
   * Format statistics for display
   */
  formatStats(): string {
    return formatStatsDisplay(this.getStats());
  }

  /**
   * Enable progress tracking globally
   */
  enable(): void {
    this.globalSettings.enabled = true;
  }

  /**
   * Disable progress tracking globally
   */
  disable(): void {
    this.globalSettings.enabled = false;
    // Abort all active progress
    for (const [chatId, progress] of this.progressMap.entries()) {
      if (progress.active) {
        progress.abort();
        this.progressMap.delete(chatId);
      }
    }
  }

  /**
   * Check if enabled
   */
  get enabled(): boolean {
    return this.globalSettings.enabled;
  }

  /**
   * Pause all active progress tracking
   */
  pauseAll(): void {
    for (const progress of this.progressMap.values()) {
      if (progress.active) {
        progress.pause();
      }
    }
  }

  /**
   * Resume all paused progress tracking
   */
  resumeAll(): void {
    for (const progress of this.progressMap.values()) {
      if (progress.active && progress.paused) {
        progress.resume();
      }
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
    this.userSettings.clear();

    // Cleanup rate limiter
    this.rateLimiter.cleanupOldBuckets();
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalSessions: 0,
      successfulCompletions: 0,
      failedCompletions: 0,
      totalRateLimitErrors: 0,
      sessionDurations: [],
    };
  }
}
