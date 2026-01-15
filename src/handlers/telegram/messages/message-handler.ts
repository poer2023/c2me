import { Context, Telegraf } from 'telegraf';
import { UserSessionModel } from '../../../models/user-session';
import { UserState, PermissionMode } from '../../../models/types';
import { IStorage } from '../../../storage/interface';
import { GitHubManager } from '../../github';
import { MessageFormatter } from '../../../utils/formatter';
import { MESSAGES } from '../../../constants/messages';
import { ClaudeManager } from '../../claude';
import { ProjectHandler } from '../project/project-handler';
import { TelegramSender } from '../../../services/telegram-sender';
import { KeyboardFactory } from '../keyboards/keyboard-factory';
import { ProgressManager } from '../../../utils/progress-manager';

export class MessageHandler {
  private telegramSender: TelegramSender;
  private progressManager: ProgressManager;

  constructor(
    private storage: IStorage,
    private github: GitHubManager,
    private formatter: MessageFormatter,
    private claudeSDK: ClaudeManager,
    private projectHandler: ProjectHandler,
    private bot: Telegraf
  ) {
    this.telegramSender = new TelegramSender(bot);
    this.progressManager = new ProgressManager(bot);
  }

  /**
   * Get progress manager instance
   */
  getProgressManager(): ProgressManager {
    return this.progressManager;
  }

  async handleTextMessage(ctx: Context): Promise<void> {
    if (!ctx.chat || !ctx.message || !('text' in ctx.message)) return;
    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    const user = await this.storage.getUserSession(chatId);
    if (!user) {
      await this.sendHelp(ctx);
      return;
    }

    switch (user.state) {
      case UserState.WaitingRepo:
        await this.projectHandler.handleRepoInput(ctx, user, text);
        break;
      case UserState.WaitingDirectory:
        await this.projectHandler.handleDirectoryInput(ctx, user, text);
        break;
      case UserState.InSession:
        await this.handleSessionInput(ctx, user, text);
        break;
      default:
        if (this.github.isGitHubURL(text)) {
          await this.projectHandler.startProjectCreation(ctx, user, text);
        } else {
          // 无项目模式：直接启动会话
          await this.startDirectSession(ctx, user, text);
        }
    }
  }

  async handleSessionInput(ctx: Context, user: UserSessionModel, text: string): Promise<void> {
    try {
      // Send initial status message and get message ID
      const statusMessage = await ctx.reply(
        '⏳ Processing (0s)',
        KeyboardFactory.createCompletionKeyboard()
      );

      // Start progress tracking
      if (statusMessage && 'message_id' in statusMessage) {
        await this.progressManager.startProgress(
          user.chatId,
          statusMessage.message_id
        );
      }

      await this.claudeSDK.addMessageToStream(user.chatId, text);
    } catch (error) {
      // Complete progress tracking on error
      await this.progressManager.completeProgress(user.chatId, false);

      await ctx.reply(
        this.formatter.formatError(
          MESSAGES.ERRORS.SEND_INPUT_FAILED(
            error instanceof Error ? error.message : 'Unknown error'
          )
        ),
        { parse_mode: 'MarkdownV2' }
      );
    }
  }

  async handleRegularMessage(chatId: number, message: any, permissionMode?: PermissionMode): Promise<void> {
    await this.sendFormattedMessage(chatId, message, permissionMode);
  }


  async sendFormattedMessage(chatId: number, message: any, permissionMode?: PermissionMode): Promise<void> {
    try {
      const formattedMessage = await this.formatter.formatClaudeMessage(message, permissionMode);
      if (formattedMessage) {
        await this.telegramSender.safeSendMessage(chatId, formattedMessage);
      }
    } catch (error) {
      console.error('Error handling Claude message:', error);
    }
  }

  private async sendHelp(ctx: Context): Promise<void> {
    const helpText = MESSAGES.HELP_TEXT;
    await ctx.reply(helpText);
  }

  /**
   * No-project mode: start session directly with default working directory
   */
  private async startDirectSession(ctx: Context, user: UserSessionModel, text: string): Promise<void> {
    try {
      // Use default working directory
      const defaultWorkDir = process.env.WORK_DIR || '/tmp/tg-claudecode';

      // Ensure directory exists
      const fs = await import('fs');
      if (!fs.existsSync(defaultWorkDir)) {
        fs.mkdirSync(defaultWorkDir, { recursive: true });
      }

      // Set user state to in session
      user.projectPath = defaultWorkDir;
      user.state = UserState.InSession;
      await this.storage.saveUserSession(user);

      // Send initial status message
      const statusMessage = await ctx.reply(
        '⏳ Processing (0s)',
        KeyboardFactory.createCompletionKeyboard()
      );

      // Start progress tracking
      if (statusMessage && 'message_id' in statusMessage) {
        await this.progressManager.startProgress(
          user.chatId,
          statusMessage.message_id
        );
      }

      await this.claudeSDK.addMessageToStream(user.chatId, text);
    } catch (error) {
      // Complete progress tracking on error
      await this.progressManager.completeProgress(user.chatId, false);
      await ctx.reply(`Failed to start session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

}