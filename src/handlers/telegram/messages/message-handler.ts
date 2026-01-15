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

export class MessageHandler {
  private telegramSender: TelegramSender;

  constructor(
    private storage: IStorage,
    private github: GitHubManager,
    private formatter: MessageFormatter,
    private claudeSDK: ClaudeManager,
    private projectHandler: ProjectHandler,
    private bot: Telegraf
  ) {
    this.telegramSender = new TelegramSender(bot);
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
      await ctx.reply('Processing...', KeyboardFactory.createCompletionKeyboard());
      await this.claudeSDK.addMessageToStream(user.chatId, text);
    } catch (error) {
      await ctx.reply(this.formatter.formatError(MESSAGES.ERRORS.SEND_INPUT_FAILED(error instanceof Error ? error.message : 'Unknown error')), { parse_mode: 'MarkdownV2' });
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
   * 无项目模式：直接使用默认工作目录启动会话
   */
  private async startDirectSession(ctx: Context, user: UserSessionModel, text: string): Promise<void> {
    try {
      // 使用默认工作目录
      const defaultWorkDir = process.env.WORK_DIR || '/tmp/tg-claudecode';

      // 确保目录存在
      const fs = await import('fs');
      if (!fs.existsSync(defaultWorkDir)) {
        fs.mkdirSync(defaultWorkDir, { recursive: true });
      }

      // 设置用户状态为会话中
      user.projectPath = defaultWorkDir;
      user.state = UserState.InSession;
      await this.storage.saveUserSession(user);

      // 发送消息给 Claude
      await ctx.reply('处理中...', KeyboardFactory.createCompletionKeyboard());
      await this.claudeSDK.addMessageToStream(user.chatId, text);
    } catch (error) {
      await ctx.reply(`启动会话失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

}