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
import { incrementCounter, startTiming } from '../../../utils/metrics';
import { downloadTelegramImage, buildMessageContent, ImageContent } from '../../../utils/image-handler';
import * as fs from 'fs';
import * as path from 'path';

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

    // Track incoming message
    incrementCounter('messages_received');
    const stopTimer = startTiming('message_processing_time');

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
          // No-project mode: start session directly
          await this.startDirectSession(ctx, user, text);
        }
    }

    // Stop message processing timer
    stopTimer();
  }

  /**
   * Handle photo messages from Telegram
   */
  async handlePhotoMessage(ctx: Context): Promise<void> {
    if (!ctx.chat || !ctx.message || !('photo' in ctx.message)) return;
    const chatId = ctx.chat.id;
    const photos = ctx.message.photo;
    const caption = ('caption' in ctx.message) ? ctx.message.caption : undefined;

    // Track incoming message
    incrementCounter('messages_received');
    const stopTimer = startTiming('message_processing_time');

    const user = await this.storage.getUserSession(chatId);
    if (!user) {
      await this.sendHelp(ctx);
      stopTimer();
      return;
    }

    // Only process photos when in session or idle (to start a new session)
    if (user.state !== UserState.InSession && user.state !== UserState.Idle) {
      await ctx.reply('Please complete your current operation first, then send the image.');
      stopTimer();
      return;
    }

    try {
      // Get the largest photo (last in array)
      const largestPhoto = photos[photos.length - 1];
      if (!largestPhoto) {
        await ctx.reply('No valid photo found in the message.');
        stopTimer();
        return;
      }

      // Notify user that we're processing the image
      const processingMsg = await ctx.reply('🖼️ Processing image...');

      // Download and convert image to base64
      const imageContent = await downloadTelegramImage(this.bot, largestPhoto.file_id);

      // Delete processing message
      try {
        await ctx.deleteMessage(processingMsg.message_id);
      } catch {
        // Ignore delete errors
      }

      // Build message content with image and optional caption
      const content = buildMessageContent(
        caption || 'Please analyze this image.',
        [imageContent]
      );

      // If not in session, start one
      if (user.state !== UserState.InSession) {
        const defaultWorkDir = process.env.WORK_DIR || '/tmp/tg-claudecode';
        const fs = await import('fs');
        if (!fs.existsSync(defaultWorkDir)) {
          fs.mkdirSync(defaultWorkDir, { recursive: true });
        }
        user.projectPath = defaultWorkDir;
        user.state = UserState.InSession;
        await this.storage.saveUserSession(user);
      }

      // Send status message
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

      // Send to Claude with image content
      await this.claudeSDK.addMessageWithContent(user.chatId, content);

    } catch (error) {
      console.error('Error processing photo:', error);
      await this.progressManager.completeProgress(user.chatId, false);
      await ctx.reply(
        `Failed to process image: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    stopTimer();
  }

  /**
   * Handle document/file messages from Telegram
   * Supports text-based files like .txt, .py, .ts, .js, .json, .md, etc.
   */
  async handleDocumentMessage(ctx: Context): Promise<void> {
    if (!ctx.chat || !ctx.message || !('document' in ctx.message)) return;
    const chatId = ctx.chat.id;
    const document = ctx.message.document;
    const caption = ('caption' in ctx.message) ? ctx.message.caption : undefined;

    // Track incoming message
    incrementCounter('messages_received');
    const stopTimer = startTiming('message_processing_time');

    const user = await this.storage.getUserSession(chatId);
    if (!user) {
      await this.sendHelp(ctx);
      stopTimer();
      return;
    }

    // Only process documents when in session or idle
    if (user.state !== UserState.InSession && user.state !== UserState.Idle) {
      await ctx.reply('Please complete your current operation first, then send the file.');
      stopTimer();
      return;
    }

    // Check file size (limit to 10MB)
    const maxFileSize = 10 * 1024 * 1024; // 10MB
    if (document.file_size && document.file_size > maxFileSize) {
      await ctx.reply('File too large. Maximum file size is 10MB.');
      stopTimer();
      return;
    }

    // Check if it's a text-based file
    const textExtensions = ['.txt', '.py', '.ts', '.js', '.jsx', '.tsx', '.json', '.md', '.yaml', '.yml', '.toml', '.xml', '.html', '.css', '.scss', '.less', '.sql', '.sh', '.bash', '.zsh', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.hpp', '.rb', '.php', '.lua', '.r', '.scala', '.clj', '.ex', '.exs', '.hs', '.ml', '.vim', '.conf', '.ini', '.env', '.gitignore', '.dockerignore', '.editorconfig'];

    const fileName = document.file_name || 'unknown';
    const fileExt = path.extname(fileName).toLowerCase();

    if (!textExtensions.includes(fileExt) && document.mime_type && !document.mime_type.startsWith('text/')) {
      await ctx.reply(`Unsupported file type: ${fileExt}. Only text-based files are supported.`);
      stopTimer();
      return;
    }

    try {
      // Notify user
      const processingMsg = await ctx.reply(`📄 Processing file: ${fileName}...`);

      // Download file
      const fileLink = await this.bot.telegram.getFileLink(document.file_id);
      const response = await fetch(fileLink.href);
      const fileContent = await response.text();

      // Delete processing message
      try {
        await ctx.deleteMessage(processingMsg.message_id);
      } catch {
        // Ignore delete errors
      }

      // Build message with file content
      const prompt = caption
        ? `${caption}\n\nFile: ${fileName}\n\`\`\`\n${fileContent}\n\`\`\``
        : `Please analyze this file.\n\nFile: ${fileName}\n\`\`\`\n${fileContent}\n\`\`\``;

      // If not in session, start one
      if (user.state !== UserState.InSession) {
        const defaultWorkDir = process.env.WORK_DIR || '/tmp/tg-claudecode';
        if (!fs.existsSync(defaultWorkDir)) {
          fs.mkdirSync(defaultWorkDir, { recursive: true });
        }
        user.projectPath = defaultWorkDir;
        user.state = UserState.InSession;
        await this.storage.saveUserSession(user);
      }

      // Send status message
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

      // Send to Claude
      await this.claudeSDK.addMessageToStream(user.chatId, prompt);

    } catch (error) {
      console.error('Error processing document:', error);
      await this.progressManager.completeProgress(user.chatId, false);
      await ctx.reply(
        `Failed to process file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    stopTimer();
  }

  /**
   * Parse @file references in message text and expand them
   * @param text - The message text
   * @param projectPath - The project root path
   * @returns Expanded message with file contents
   */
  async parseFileReferences(text: string, projectPath: string): Promise<string> {
    // Match @file patterns like @src/main.ts or @./package.json
    const filePattern = /@([^\s@]+\.[a-zA-Z0-9]+)/g;
    const matches = text.matchAll(filePattern);

    let expandedText = text;
    const fileContents: string[] = [];

    for (const match of matches) {
      const filePath = match[1];
      if (!filePath) continue;

      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(projectPath, filePath);

      try {
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const fileName = path.basename(fullPath);
          fileContents.push(`\n\n📄 **${filePath}**:\n\`\`\`\n${content}\n\`\`\``);
          // Remove the @reference from original text
          expandedText = expandedText.replace(match[0], `[${fileName}]`);
        }
      } catch (error) {
        console.warn(`Failed to read file ${filePath}:`, error);
      }
    }

    if (fileContents.length > 0) {
      return expandedText + '\n\n---\n**Referenced Files:**' + fileContents.join('');
    }

    return text;
  }

  async handleSessionInput(ctx: Context, user: UserSessionModel, text: string): Promise<void> {
    try {
      // Parse @file references and expand them
      let processedText = text;
      if (text.includes('@') && user.projectPath) {
        processedText = await this.parseFileReferences(text, user.projectPath);
      }

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

      await this.claudeSDK.addMessageToStream(user.chatId, processedText);
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