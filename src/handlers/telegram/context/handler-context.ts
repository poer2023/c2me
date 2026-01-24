import { Telegraf } from 'telegraf';
import { IStorage } from '../../../storage/interface';
import { MessageFormatter } from '../../../utils/formatter';
import { Config } from '../../../config/config';
import { PermissionManager } from '../../permission-manager';
import { ProgressManager } from '../../../utils/progress-manager';
import { TelegramSender } from '../../../services/telegram-sender';

/**
 * Shared context for all Telegram handlers
 * Eliminates circular setter injection by providing a centralized dependency container
 */
export class HandlerContext {
  public readonly bot: Telegraf;
  public readonly storage: IStorage;
  public readonly formatter: MessageFormatter;
  public readonly config: Config;
  public readonly permissionManager: PermissionManager;
  public readonly progressManager: ProgressManager;
  public readonly telegramSender: TelegramSender;

  // Lazy-initialized references to avoid circular dependencies
  private _claudeManager: unknown = null;
  private _toolHandler: unknown = null;
  private _messageHandler: unknown = null;
  private _callbackHandler: unknown = null;
  private _progressControlHandler: unknown = null;

  constructor(options: {
    bot: Telegraf;
    storage: IStorage;
    formatter: MessageFormatter;
    config: Config;
    permissionManager: PermissionManager;
  }) {
    this.bot = options.bot;
    this.storage = options.storage;
    this.formatter = options.formatter;
    this.config = options.config;
    this.permissionManager = options.permissionManager;
    this.progressManager = new ProgressManager(options.bot);
    this.telegramSender = new TelegramSender(options.bot);
  }

  // Lazy accessors for handler references
  get claudeManager() { return this._claudeManager; }
  set claudeManager(value) { this._claudeManager = value; }

  get toolHandler() { return this._toolHandler; }
  set toolHandler(value) { this._toolHandler = value; }

  get messageHandler() { return this._messageHandler; }
  set messageHandler(value) { this._messageHandler = value; }

  get callbackHandler() { return this._callbackHandler; }
  set callbackHandler(value) { this._callbackHandler = value; }

  get progressControlHandler() { return this._progressControlHandler; }
  set progressControlHandler(value) { this._progressControlHandler = value; }

  /**
   * Initialize all handler references after construction
   * Called once after all handlers are created
   */
  initializeHandlers(handlers: {
    claudeManager?: unknown;
    toolHandler?: unknown;
    messageHandler?: unknown;
    callbackHandler?: unknown;
    progressControlHandler?: unknown;
  }): void {
    if (handlers.claudeManager) this._claudeManager = handlers.claudeManager;
    if (handlers.toolHandler) this._toolHandler = handlers.toolHandler;
    if (handlers.messageHandler) this._messageHandler = handlers.messageHandler;
    if (handlers.callbackHandler) this._callbackHandler = handlers.callbackHandler;
    if (handlers.progressControlHandler) this._progressControlHandler = handlers.progressControlHandler;
  }

  /**
   * Set up rate limit notification callback
   */
  setupRateLimitNotification(): void {
    this.progressManager.onGlobalRateLimit((chatId, retryAfter) => {
      this.bot.telegram.sendMessage(
        chatId,
        `⚠️ Rate limit detected. Pausing for ${retryAfter}s to avoid API restrictions.`
      ).catch(() => { });
    });
  }
}
