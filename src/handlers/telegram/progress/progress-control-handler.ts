import { Context, Telegraf } from 'telegraf';
import { ProgressManager } from '../../../utils/progress-manager';
import { KeyboardFactory } from '../keyboards/keyboard-factory';
import { SAFE_LIMITS, validateSettings, DEFAULT_PROGRESS_SETTINGS } from '../../../utils/progress-config';
import { TelegramSender } from '../../../services/telegram-sender';

/**
 * ProgressControlHandler - Handles Telegram commands and callbacks for progress settings
 */
export class ProgressControlHandler {
  private telegramSender: TelegramSender;

  constructor(
    private bot: Telegraf,
    private progressManager: ProgressManager
  ) {
    this.telegramSender = new TelegramSender(bot);
  }

  /**
   * Handle /progress command - show progress settings
   */
  async handleProgressCommand(ctx: Context): Promise<void> {
    if (!ctx.chat) return;

    const chatId = ctx.chat.id;
    const settings = this.progressManager.getUserSettings(chatId);
    const text = this.progressManager.formatSettings(chatId);

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      ...KeyboardFactory.createProgressSettingsKeyboard(settings),
    });
  }

  /**
   * Handle /progressstats command - show progress statistics
   */
  async handleProgressStatsCommand(ctx: Context): Promise<void> {
    if (!ctx.chat) return;

    const text = this.progressManager.formatStats();
    const rateLimiterStats = this.progressManager.getRateLimiterStats();

    const fullText = `${text}

🚦 **Rate Limiter:**
• Global Tokens: ${rateLimiterStats.globalTokens}
• Active Buckets: ${rateLimiterStats.activeChatBuckets}
• Max Req/s: ${rateLimiterStats.config.maxRequestsPerSecond}
• Max Req/min/chat: ${rateLimiterStats.config.maxRequestsPerMinutePerChat}`;

    await ctx.reply(fullText, {
      parse_mode: 'Markdown',
      ...KeyboardFactory.createProgressStatsKeyboard(),
    });
  }

  /**
   * Handle progress callback queries
   */
  async handleProgressCallback(ctx: Context, data: string): Promise<void> {
    if (!ctx.chat || !ctx.callbackQuery) return;

    const chatId = ctx.chat.id;
    const parts = data.split(':');
    const action = parts[1] || '';
    const subAction = parts[2] || '';

    try {
      switch (action) {
        case 'toggle':
          if (subAction) {
            await this.handleToggle(ctx, chatId, subAction);
          }
          break;
        case 'preset':
          if (subAction === 'safe' || subAction === 'balanced' || subAction === 'aggressive') {
            await this.handlePreset(ctx, chatId, subAction);
          }
          break;
        case 'intervals':
          await this.showIntervalsMenu(ctx, chatId);
          break;
        case 'stats':
          if (subAction === 'refresh') {
            await this.refreshStats(ctx);
          } else if (subAction === 'reset') {
            await this.resetStats(ctx);
          } else {
            await this.showStatsMenu(ctx);
          }
          break;
        case 'edit':
          if (subAction === 'increase' || subAction === 'decrease') {
            await this.adjustInterval(ctx, chatId, 'minEditInterval', subAction);
          }
          break;
        case 'heartbeat':
          if (subAction === 'increase' || subAction === 'decrease') {
            await this.adjustInterval(ctx, chatId, 'heartbeatInterval', subAction);
          }
          break;
        case 'status':
          if (subAction === 'increase' || subAction === 'decrease') {
            await this.adjustInterval(ctx, chatId, 'statusUpdateInterval', subAction);
          }
          break;
        case 'reset':
          await this.resetSettings(ctx, chatId);
          break;
        case 'back':
          await this.showMainMenu(ctx, chatId);
          break;
        case 'close':
          await this.closeMenu(ctx);
          break;
        default:
          await ctx.answerCbQuery('Unknown action');
      }
    } catch (error) {
      console.error('Error handling progress callback:', error);
      await ctx.answerCbQuery('Error processing request');
    }
  }

  /**
   * Handle toggle actions
   */
  private async handleToggle(ctx: Context, chatId: number, toggle: string): Promise<void> {
    const settings = this.progressManager.getUserSettings(chatId);

    switch (toggle) {
      case 'enabled':
        this.progressManager.setUserSettings(chatId, { enabled: !settings.enabled });
        break;
      case 'toolDetails':
        this.progressManager.setUserSettings(chatId, { showToolDetails: !settings.showToolDetails });
        break;
      case 'elapsedTime':
        this.progressManager.setUserSettings(chatId, { showElapsedTime: !settings.showElapsedTime });
        break;
      case 'autoPause':
        this.progressManager.setUserSettings(chatId, { autoPauseOnRateLimit: !settings.autoPauseOnRateLimit });
        break;
      case 'dynamic':
        this.progressManager.setUserSettings(chatId, { dynamicIntervalAdjustment: !settings.dynamicIntervalAdjustment });
        break;
    }

    await this.updateMainMenu(ctx, chatId);
    await ctx.answerCbQuery('Setting updated');
  }

  /**
   * Handle preset selection
   */
  private async handlePreset(ctx: Context, chatId: number, preset: 'safe' | 'balanced' | 'aggressive'): Promise<void> {
    this.progressManager.applyPreset(preset);
    this.progressManager.clearUserSettings(chatId); // Clear user overrides to use global preset

    await this.updateMainMenu(ctx, chatId);
    await ctx.answerCbQuery(`Applied ${preset} preset`);
  }

  /**
   * Show intervals adjustment menu
   */
  private async showIntervalsMenu(ctx: Context, chatId: number): Promise<void> {
    const settings = this.progressManager.getUserSettings(chatId);

    const text = `⏱️ **Interval Settings**

Adjust the intervals for progress tracking.
Larger intervals = Safer, but less responsive.
Smaller intervals = More responsive, but higher API usage.

**Safe Limits:**
• Edit: ${SAFE_LIMITS.MIN_EDIT_INTERVAL / 1000}s - ${SAFE_LIMITS.MAX_EDIT_INTERVAL / 1000}s
• Heartbeat: ${SAFE_LIMITS.MIN_HEARTBEAT / 1000}s - ${SAFE_LIMITS.MAX_HEARTBEAT / 1000}s
• Status: ${SAFE_LIMITS.MIN_STATUS_UPDATE / 1000}s - ${SAFE_LIMITS.MAX_STATUS_UPDATE / 1000}s`;

    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...KeyboardFactory.createProgressIntervalsKeyboard(settings),
    });
    await ctx.answerCbQuery();
  }

  /**
   * Adjust interval setting
   */
  private async adjustInterval(
    ctx: Context,
    chatId: number,
    intervalKey: 'minEditInterval' | 'heartbeatInterval' | 'statusUpdateInterval',
    direction: 'increase' | 'decrease'
  ): Promise<void> {
    const settings = this.progressManager.getUserSettings(chatId);
    const step = 1000; // 1 second step
    let newValue = settings[intervalKey];

    if (direction === 'increase') {
      newValue += step;
    } else {
      newValue -= step;
    }

    // Apply limits based on interval type
    const limits = {
      minEditInterval: { min: SAFE_LIMITS.MIN_EDIT_INTERVAL, max: SAFE_LIMITS.MAX_EDIT_INTERVAL },
      heartbeatInterval: { min: SAFE_LIMITS.MIN_HEARTBEAT, max: SAFE_LIMITS.MAX_HEARTBEAT },
      statusUpdateInterval: { min: SAFE_LIMITS.MIN_STATUS_UPDATE, max: SAFE_LIMITS.MAX_STATUS_UPDATE },
    };

    const { min, max } = limits[intervalKey];
    newValue = Math.max(min, Math.min(max, newValue));

    this.progressManager.setUserSettings(chatId, { [intervalKey]: newValue });

    // Refresh the intervals menu
    await this.showIntervalsMenu(ctx, chatId);
  }

  /**
   * Show stats menu
   */
  private async showStatsMenu(ctx: Context): Promise<void> {
    const text = this.progressManager.formatStats();
    const rateLimiterStats = this.progressManager.getRateLimiterStats();

    const fullText = `${text}

🚦 **Rate Limiter:**
• Global Tokens: ${rateLimiterStats.globalTokens}
• Active Buckets: ${rateLimiterStats.activeChatBuckets}`;

    await ctx.editMessageText(fullText, {
      parse_mode: 'Markdown',
      ...KeyboardFactory.createProgressStatsKeyboard(),
    });
    await ctx.answerCbQuery();
  }

  /**
   * Refresh stats display
   */
  private async refreshStats(ctx: Context): Promise<void> {
    await this.showStatsMenu(ctx);
    await ctx.answerCbQuery('Stats refreshed');
  }

  /**
   * Reset statistics
   */
  private async resetStats(ctx: Context): Promise<void> {
    this.progressManager.resetStats();
    await this.showStatsMenu(ctx);
    await ctx.answerCbQuery('Statistics reset');
  }

  /**
   * Reset settings to default
   */
  private async resetSettings(ctx: Context, chatId: number): Promise<void> {
    this.progressManager.clearUserSettings(chatId);
    this.progressManager.updateGlobalSettings(DEFAULT_PROGRESS_SETTINGS);
    await this.updateMainMenu(ctx, chatId);
    await ctx.answerCbQuery('Settings reset to default');
  }

  /**
   * Show main menu
   */
  private async showMainMenu(ctx: Context, chatId: number): Promise<void> {
    const settings = this.progressManager.getUserSettings(chatId);
    const text = this.progressManager.formatSettings(chatId);

    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...KeyboardFactory.createProgressSettingsKeyboard(settings),
    });
    await ctx.answerCbQuery();
  }

  /**
   * Update main menu in place
   */
  private async updateMainMenu(ctx: Context, chatId: number): Promise<void> {
    const settings = this.progressManager.getUserSettings(chatId);
    const text = this.progressManager.formatSettings(chatId);

    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...KeyboardFactory.createProgressSettingsKeyboard(settings),
    });
  }

  /**
   * Close the menu
   */
  private async closeMenu(ctx: Context): Promise<void> {
    await ctx.deleteMessage();
    await ctx.answerCbQuery('Menu closed');
  }
}
