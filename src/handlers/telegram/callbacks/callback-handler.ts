import { Context, Telegraf } from 'telegraf';
import { IStorage } from '../../../storage/interface';
import { MessageFormatter } from '../../../utils/formatter';
import { ProjectHandler } from '../project/project-handler';
import { FileBrowserHandler } from '../file-browser/file-browser-handler';
import { UserState, PermissionMode } from '../../../models/types';
import { PermissionManager } from '../../permission-manager';
import { ProgressControlHandler } from '../progress/progress-control-handler';
import { ClaudeManager } from '../../claude';

export class CallbackHandler {
  private progressControlHandler: ProgressControlHandler | null = null;
  private claudeSDK: ClaudeManager | null = null;

  constructor(
    private formatter: MessageFormatter,
    private projectHandler: ProjectHandler,
    private storage: IStorage,
    private fileBrowserHandler: FileBrowserHandler,
    private bot: Telegraf,
    private permissionManager: PermissionManager
  ) {}

  /**
   * Set Claude SDK manager for model switching
   */
  setClaudeManager(claudeSDK: ClaudeManager): void {
    this.claudeSDK = claudeSDK;
  }

  /**
   * Set progress control handler (called after initialization)
   */
  setProgressControlHandler(handler: ProgressControlHandler): void {
    this.progressControlHandler = handler;
  }

  async handleCallback(ctx: Context): Promise<void> {
    if (!ctx.callbackQuery || !ctx.chat) return;
    if (!('data' in ctx.callbackQuery)) return;

    const data = ctx.callbackQuery.data;
    const chatId = ctx.chat.id;
    const messageId = ctx.callbackQuery?.message?.message_id;

    // Handle progress callbacks separately (they manage their own answerCbQuery)
    if (data?.startsWith('progress:')) {
      if (this.progressControlHandler) {
        await this.progressControlHandler.handleProgressCallback(ctx, data);
      } else {
        await ctx.answerCbQuery('Progress control not available');
      }
      return;
    }

    await ctx.answerCbQuery();

    if (data?.startsWith('project_type_')) {
      await this.projectHandler.handleProjectTypeSelection(data, chatId);
    } else if (data?.startsWith('project_select_')) {
      await this.handleProjectSelection(data, chatId, messageId);
    } else if (data === 'cancel') {
      await this.handleCancelCallback(chatId, messageId);
    } else if (data?.startsWith('approve_') || data?.startsWith('deny_')) {
      await this.handleMCPApprovalCallback(data, chatId, messageId);
    } else if (data?.startsWith('file:') || data?.startsWith('directory:') || data?.startsWith('nav:')) {
      await this.fileBrowserHandler.handleFileBrowsingCallback(data, chatId, messageId);
    } else if (data?.startsWith('perm:')) {
      await this.handlePermissionSwitchCallback(data, chatId, messageId);
    } else if (data?.startsWith('model:')) {
      await this.handleModelSelectionCallback(data, chatId, messageId);
    }
  }

  /**
   * Handle quick permission mode switch from inline keyboard
   */
  private async handlePermissionSwitchCallback(data: string, chatId: number, messageId?: number): Promise<void> {
    try {
      const modeStr = data.replace('perm:', '');
      let mode: PermissionMode;

      switch (modeStr) {
        case 'default':
          mode = PermissionMode.Default;
          break;
        case 'acceptedits':
          mode = PermissionMode.AcceptEdits;
          break;
        case 'plan':
          mode = PermissionMode.Plan;
          break;
        case 'bypass':
          mode = PermissionMode.BypassPermissions;
          break;
        default:
          await this.bot.telegram.sendMessage(chatId, 'Invalid permission mode');
          return;
      }

      const user = await this.storage.getUserSession(chatId);
      if (!user) {
        await this.bot.telegram.sendMessage(chatId, this.formatter.formatError('No session found.'), { parse_mode: 'MarkdownV2' });
        return;
      }

      user.setPermissionMode(mode);
      await this.storage.saveUserSession(user);

      const modeNames: Record<PermissionMode, string> = {
        [PermissionMode.Default]: '🛡️ Default',
        [PermissionMode.AcceptEdits]: '✏️ AcceptEdits',
        [PermissionMode.Plan]: '📋 Plan',
        [PermissionMode.BypassPermissions]: '⚡ Bypass',
      };

      // Delete the keyboard message
      if (messageId) {
        try {
          await this.bot.telegram.deleteMessage(chatId, messageId);
        } catch {
          // Ignore delete errors
        }
      }

      await this.bot.telegram.sendMessage(chatId, `✅ Permission mode changed to: ${modeNames[mode]}`);
    } catch (error) {
      console.error('Error handling permission switch:', error);
      await this.bot.telegram.sendMessage(chatId, this.formatter.formatError('Failed to switch permission mode.'), { parse_mode: 'MarkdownV2' });
    }
  }

  /**
   * Handle model selection from inline keyboard
   */
  private async handleModelSelectionCallback(data: string, chatId: number, messageId?: number): Promise<void> {
    try {
      const model = data.replace('model:', '');

      if (!['opus', 'sonnet', 'haiku'].includes(model)) {
        await this.bot.telegram.sendMessage(chatId, 'Invalid model selection');
        return;
      }

      // Delete the keyboard message
      if (messageId) {
        try {
          await this.bot.telegram.deleteMessage(chatId, messageId);
        } catch {
          // Ignore delete errors
        }
      }

      // Send model switch command to Claude SDK
      if (this.claudeSDK) {
        await this.claudeSDK.addMessageToStream(chatId, `/model ${model}`);
        await this.bot.telegram.sendMessage(chatId, `🤖 Switching to ${model.toUpperCase()} model...`);
      } else {
        await this.bot.telegram.sendMessage(chatId, 'Claude SDK not available for model switching.');
      }
    } catch (error) {
      console.error('Error handling model selection:', error);
      await this.bot.telegram.sendMessage(chatId, this.formatter.formatError('Failed to switch model.'), { parse_mode: 'MarkdownV2' });
    }
  }

  private async handleMCPApprovalCallback(data: string, chatId: number, messageId?: number): Promise<void> {
    try {
      await this.permissionManager.handleApprovalCallback(chatId, data);

      const isApproved = data.startsWith('approve_');
      const message = isApproved ? '✅ Operation approved' : '❌ Operation denied';
      await this.bot.telegram.sendMessage(chatId, message);

      if (messageId) {
        await this.bot.telegram.deleteMessage(chatId, messageId);
      }
    } catch (error) {
      console.error('Error handling approval callback:', error);
      await this.bot.telegram.sendMessage(chatId, this.formatter.formatError('Error handling permission response'), { parse_mode: 'MarkdownV2' });
    }
  }

  private async handleProjectSelection(data: string, chatId: number, messageId?: number): Promise<void> {
    try {
      const projectId = data.replace('project_select_', '');
      const user = await this.storage.getUserSession(chatId);
      
      if (!user) {
        await this.bot.telegram.sendMessage(chatId, this.formatter.formatError('No user session found.'), { parse_mode: 'MarkdownV2' });
        return;
      }

      const project = await this.storage.getProject(projectId, chatId);
      if (!project) {
        await this.bot.telegram.sendMessage(chatId, this.formatter.formatError('Project not found.'), { parse_mode: 'MarkdownV2' });
        return;
      }

      // Set active project and update session
      user.setActiveProject(projectId, project.localPath);
      user.setState(UserState.InSession);
      user.setActive(true);
      // Clear previous session ID to start fresh
      delete user.sessionId;
      await this.storage.saveUserSession(user);

      // Update project last accessed time
      await this.storage.updateProjectLastAccessed(projectId, chatId);

      // Delete the project list message
      if (messageId) {
        try {
          await this.bot.telegram.deleteMessage(chatId, messageId);
        } catch (error) {
          console.error('Could not delete message:', error);
        }
      }

      await this.bot.telegram.sendMessage(
        chatId, 
        `🚀 Selected project "${project.name}". You can now chat with Claude Code!`
      );
    } catch (error) {
      console.error('Error handling project selection:', error);
      await this.bot.telegram.sendMessage(chatId, this.formatter.formatError('Failed to select project. Please try again.'), { parse_mode: 'MarkdownV2' });
    }
  }


  private async handleCancelCallback(chatId: number, messageId?: number): Promise<void> {
    try {
      // Delete the message with inline keyboard
      if (messageId) {
        await this.bot.telegram.deleteMessage(chatId, messageId);
      }
      
      await this.bot.telegram.sendMessage(chatId, '❌ Operation cancelled.');
    } catch (error) {
      console.error('Error handling cancel callback:', error);
    }
  }
}