import { Telegraf } from 'telegraf';
import { PermissionMode } from '../models/types';
import { IStorage } from '../storage/interface';
import { GitHubManager } from './github';
import { DirectoryManager } from './directory';
import { ClaudeManager } from './claude';
import { MessageFormatter } from '../utils/formatter';
import { message } from 'telegraf/filters';
import { Config } from '../config/config';
import { PermissionManager } from './permission-manager';

// Import handlers
import { CommandHandler } from './telegram/commands/command-handler';
import { CallbackHandler } from './telegram/callbacks/callback-handler';
import { MessageHandler } from './telegram/messages/message-handler';
import { ToolHandler } from './telegram/tools/tool-handler';
import { FileBrowserHandler } from './telegram/file-browser/file-browser-handler';
import { ProjectHandler } from './telegram/project/project-handler';
import { ProgressControlHandler } from './telegram/progress/progress-control-handler';

export class TelegramHandler {
  private bot: Telegraf;
  private github: GitHubManager;
  private directory: DirectoryManager;
  private storage: IStorage;
  private claudeSDK: ClaudeManager;
  private formatter: MessageFormatter;
  private config: Config;
  private permissionManager: PermissionManager;

  // Handlers
  private commandHandler: CommandHandler;
  private callbackHandler: CallbackHandler;
  private messageHandler: MessageHandler;
  private toolHandler: ToolHandler;
  private fileBrowserHandler: FileBrowserHandler;
  private projectHandler: ProjectHandler;
  private progressControlHandler: ProgressControlHandler;

  constructor(
    bot: Telegraf,
    github: GitHubManager,
    directory: DirectoryManager,
    claudeSDK: ClaudeManager,
    storage: IStorage,
    formatter: MessageFormatter,
    config: Config,
    permissionManager: PermissionManager
  ) {
    this.bot = bot;
    this.github = github;
    this.directory = directory;
    this.storage = storage;
    this.claudeSDK = claudeSDK;
    this.formatter = formatter;
    this.config = config;
    this.permissionManager = permissionManager;

    // Initialize handlers
    this.commandHandler = new CommandHandler(this.storage, this.formatter, this.claudeSDK, this.config, this.bot);
    this.projectHandler = new ProjectHandler(this.storage, this.github, this.directory, this.formatter, this.bot);
    this.messageHandler = new MessageHandler(this.storage, this.github, this.formatter, this.claudeSDK, this.projectHandler, this.bot);
    this.toolHandler = new ToolHandler(this.storage, this.formatter, this.config, this.bot, this.claudeSDK);
    this.fileBrowserHandler = new FileBrowserHandler(this.storage, this.directory, this.formatter, this.config, this.bot);
    this.callbackHandler = new CallbackHandler(this.formatter, this.projectHandler, this.storage, this.fileBrowserHandler, this.bot, this.permissionManager);

    // Initialize progress control handler
    this.progressControlHandler = new ProgressControlHandler(this.bot, this.messageHandler.getProgressManager());

    // Connect progress manager to tool handler
    this.toolHandler.setProgressManager(this.messageHandler.getProgressManager());

    // Connect tool handler to message handler for aggregation
    this.messageHandler.setToolHandler(this.toolHandler);

    // Connect progress control handler to callback handler
    this.callbackHandler.setProgressControlHandler(this.progressControlHandler);

    // Connect Claude SDK to callback handler for model switching
    this.callbackHandler.setClaudeManager(this.claudeSDK);

    // Connect ToolHandler to callback handler for execution control
    this.callbackHandler.setToolHandler(this.toolHandler);

    // Set up rate limit notification
    this.messageHandler.getProgressManager().onGlobalRateLimit((chatId, retryAfter) => {
      this.bot.telegram.sendMessage(
        chatId,
        `⚠️ Rate limit detected. Pausing for ${retryAfter}s to avoid API restrictions.`
      ).catch(() => { });
    });

    // Register bot commands menu (visible when user taps "/" in Telegram)
    this.bot.telegram.setMyCommands([
      { command: 'start', description: '开始使用' },
      { command: 'new', description: '创建新项目' },
      { command: 'list', description: '项目列表' },
      { command: 'clear', description: '清除会话' },
      { command: 'abort', description: '中止任务' },
      { command: 'compact', description: '压缩上下文' },
      { command: 'undo', description: '撤销操作' },
      { command: 'model', description: '切换模型' },
      { command: 'progress', description: '进度设置' },
      { command: 'help', description: '帮助文档' },
    ]).catch(err => console.error('Failed to set bot commands:', err));

    this.setupHandlers();
  }

  public async handleClaudeResponse(userId: string, message: any, toolInfo?: { toolId: string; toolName: string; isToolUse: boolean; isToolResult: boolean }, parentToolUseId?: string): Promise<void> {
    const chatId = parseInt(userId);
    if (isNaN(chatId)) return;

    // If message is null, this indicates completion
    if (!message) {
      // End aggregation session and get summary
      const summary = this.toolHandler.endAggregation(chatId);

      // Complete progress tracking
      await this.messageHandler.getProgressManager().completeProgress(chatId, true);

      // Send completion summary if there were aggregated steps
      if (summary) {
        try {
          await this.bot.telegram.sendMessage(chatId, summary);
        } catch (error) {
          console.error('Failed to send aggregation summary:', error);
        }
      }
      return;
    }

    await this.handleClaudeMessage(chatId, message, toolInfo, parentToolUseId);
  }

  public async handleClaudeError(userId: string, error: string): Promise<void> {
    const chatId = parseInt(userId);
    if (isNaN(chatId)) return;

    // Complete progress tracking on error
    await this.messageHandler.getProgressManager().completeProgress(chatId, false);

    try {
      await this.bot.telegram.sendMessage(
        chatId,
        this.formatter.formatError(`Claude Error: ${error}`),
        { parse_mode: 'MarkdownV2' }
      );
    } catch (error) {
      console.error('Error sending error message:', error);
    }
  }


  private setupHandlers(): void {
    // Command handlers with activity tracking
    this.bot.start((ctx) => this.withTracking(ctx, 'start', () => this.commandHandler.handleStart(ctx)));
    this.bot.command('createproject', (ctx) => this.withTracking(ctx, 'createproject', () => this.commandHandler.handleCreateProject(ctx)));
    this.bot.command('new', (ctx) => this.withTracking(ctx, 'new', () => this.commandHandler.handleCreateProject(ctx)));
    this.bot.command('listproject', (ctx) => this.withTracking(ctx, 'listproject', () => this.commandHandler.handleListProject(ctx)));
    this.bot.command('list', (ctx) => this.withTracking(ctx, 'list', () => this.commandHandler.handleListProject(ctx)));
    this.bot.command('exitproject', (ctx) => this.withTracking(ctx, 'exitproject', () => this.commandHandler.handleExitProject(ctx)));

    this.bot.command('help', (ctx) => this.withTracking(ctx, 'help', () => this.commandHandler.handleHelp(ctx)));
    this.bot.command('status', (ctx) => this.withTracking(ctx, 'status', () => this.commandHandler.handleStatus(ctx)));
    this.bot.command('ls', (ctx) => this.withTracking(ctx, 'ls', () => this.fileBrowserHandler.handleLsCommand(ctx)));
    this.bot.command('auth', (ctx) => this.withTracking(ctx, 'auth', () => this.commandHandler.handleAuth(ctx)));

    this.bot.command('abort', (ctx) => this.withTracking(ctx, 'abort', () => this.commandHandler.handleAbort(ctx)));
    this.bot.command('clear', (ctx) => this.withTracking(ctx, 'clear', () => this.commandHandler.handleClear(ctx)));

    // Permission mode commands
    this.bot.command('default', (ctx) => this.withTracking(ctx, 'default', () => this.commandHandler.handlePermissionModeChange(ctx, PermissionMode.Default)));
    this.bot.command('acceptedits', (ctx) => this.withTracking(ctx, 'acceptedits', () => this.commandHandler.handlePermissionModeChange(ctx, PermissionMode.AcceptEdits)));
    this.bot.command('plan', (ctx) => this.withTracking(ctx, 'plan', () => this.commandHandler.handlePermissionModeChange(ctx, PermissionMode.Plan)));
    this.bot.command('bypass', (ctx) => this.withTracking(ctx, 'bypass', () => this.commandHandler.handlePermissionModeChange(ctx, PermissionMode.BypassPermissions)));

    // Progress control commands
    this.bot.command('progress', (ctx) => this.withTracking(ctx, 'progress', () => this.progressControlHandler.handleProgressCommand(ctx)));
    this.bot.command('progressstats', (ctx) => this.withTracking(ctx, 'progressstats', () => this.progressControlHandler.handleProgressStatsCommand(ctx)));

    // Phase 5A: Claude Code aligned commands
    this.bot.command('compact', (ctx) => this.withTracking(ctx, 'compact', () => this.commandHandler.handleCompact(ctx)));
    this.bot.command('model', (ctx) => this.withTracking(ctx, 'model', () => this.commandHandler.handleModel(ctx)));
    this.bot.command('init', (ctx) => this.withTracking(ctx, 'init', () => this.commandHandler.handleInit(ctx)));
    this.bot.command('review', (ctx) => this.withTracking(ctx, 'review', () => this.commandHandler.handleReview(ctx)));
    this.bot.command('undo', (ctx) => this.withTracking(ctx, 'undo', () => this.commandHandler.handleUndo(ctx)));

    // Text message handler with activity tracking
    this.bot.on(message('text'), (ctx) => this.withTracking(ctx, undefined, () => this.messageHandler.handleTextMessage(ctx)));

    // Photo message handler with activity tracking
    this.bot.on(message('photo'), (ctx) => this.withTracking(ctx, 'photo', () => this.messageHandler.handlePhotoMessage(ctx)));

    // Document/file message handler with activity tracking
    this.bot.on(message('document'), (ctx) => this.withTracking(ctx, 'document', () => this.messageHandler.handleDocumentMessage(ctx)));

    this.bot.on('callback_query', (ctx) => this.callbackHandler.handleCallback(ctx));
  }

  /**
   * Wrap handler with user activity tracking (Phase 3: async fire-and-forget)
   */
  private async withTracking(ctx: any, command?: string, handler?: () => Promise<void>): Promise<void> {
    // Phase 3: Fire-and-forget activity tracking - don't block the main request
    if (ctx.chat && ctx.from) {
      this.trackActivityAsync(ctx, command).catch((error) => {
        console.error('Failed to track user activity:', error);
      });
    }

    // Execute the actual handler immediately without waiting for tracking
    if (handler) {
      await handler();
    }
  }

  /**
   * Async activity tracking - runs in background without blocking requests
   */
  private async trackActivityAsync(ctx: any, command?: string): Promise<void> {
    const update: {
      chatId: number;
      username?: string;
      firstName?: string;
      lastName?: string;
      command?: string;
      timestamp: Date;
    } = {
      chatId: ctx.chat.id,
      timestamp: new Date(),
    };

    if (ctx.from.username) update.username = ctx.from.username;
    if (ctx.from.first_name) update.firstName = ctx.from.first_name;
    if (ctx.from.last_name) update.lastName = ctx.from.last_name;
    if (command) update.command = command;

    await this.storage.trackUserActivity(update);
  }

  public async handleClaudeMessage(chatId: number, message: any, toolInfo?: { toolId: string; toolName: string; isToolUse: boolean; isToolResult: boolean }, parentToolUseId?: string): Promise<void> {
    const user = await this.storage.getUserSession(chatId);
    if (!user || !user.sessionId) return;

    if (toolInfo) {
      if (toolInfo.isToolUse) {
        await this.toolHandler.handleToolUse(chatId, message, toolInfo, user, parentToolUseId);
        return;
      }
      if (toolInfo.isToolResult) {
        await this.toolHandler.handleToolResult(chatId, message, toolInfo, user, parentToolUseId);
        return;
      }
    }

    await this.messageHandler.handleRegularMessage(chatId, message, user.permissionMode);
  }

  public async cleanup(): Promise<void> {
    try {
      console.log('TelegramHandler cleanup completed');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
}