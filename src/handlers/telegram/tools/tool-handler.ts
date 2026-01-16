import { Markup, Telegraf } from 'telegraf';
import { UserSessionModel } from '../../../models/user-session';
import { TargetTool, PermissionMode, getToolVisibilityLevel } from '../../../models/types';
import { IStorage, ToolData } from '../../../storage/interface';
import { MessageFormatter } from '../../../utils/formatter';
import { Config } from '../../../config/config';
import { TelegramSender } from '../../../services/telegram-sender';
import { ClaudeManager } from '../../claude';
import { ProgressManager } from '../../../utils/progress-manager';
import { MessageAggregator } from '../../../services/message-aggregator';

export interface ToolInfo {
  toolId: string;
  toolName: string;
  isToolUse: boolean;
  isToolResult: boolean;
}

export class ToolHandler {
  private telegramSender: TelegramSender;
  private progressManager: ProgressManager | null = null;
  private aggregator: MessageAggregator;
  private useAggregator: boolean = true; // Feature flag for aggregated messages

  constructor(
    private storage: IStorage,
    private formatter: MessageFormatter,
    private config: Config,
    private bot: Telegraf,
    private claudeManager?: ClaudeManager
  ) {
    this.telegramSender = new TelegramSender(bot);
    this.aggregator = new MessageAggregator(bot, {
      minUpdateInterval: 1500,
      showLowVisibilitySteps: false,
      collapseReadOperations: true,
      maxVisibleSteps: 10,
    });
  }

  /**
   * Set progress manager instance for tool status updates
   */
  setProgressManager(progressManager: ProgressManager): void {
    this.progressManager = progressManager;
  }

  /**
   * Enable or disable aggregated message mode
   */
  setUseAggregator(enabled: boolean): void {
    this.useAggregator = enabled;
  }

  /**
   * Start aggregation session for a chat
   */
  startAggregation(chatId: number, messageId: number): void {
    if (this.useAggregator) {
      this.aggregator.startSession(chatId, messageId);
    }
  }

  /**
   * End aggregation session and get completion summary
   */
  endAggregation(chatId: number): string {
    if (this.useAggregator && this.aggregator.hasSession(chatId)) {
      return this.aggregator.endSession(chatId);
    }
    return '';
  }

  /**
   * Abort aggregation session
   */
  abortAggregation(chatId: number): void {
    if (this.aggregator.hasSession(chatId)) {
      this.aggregator.abortSession(chatId);
    }
  }

  /**
   * Check if aggregation is active for a chat
   */
  hasActiveAggregation(chatId: number): boolean {
    return this.aggregator.hasSession(chatId);
  }

  /**
   * Get the aggregator instance
   */
  getAggregator(): MessageAggregator {
    return this.aggregator;
  }

  async handleToolUse(chatId: number, message: any, toolInfo: ToolInfo, user: UserSessionModel, parentToolUseId?: string): Promise<void> {
    const input = this.extractToolInput(message, toolInfo.toolName);

    // Update progress status with current tool
    if (this.progressManager) {
      this.progressManager.updateTool(chatId, toolInfo.toolName, input);
    }

    // If aggregation is active, add step to aggregator
    if (this.useAggregator && this.aggregator.hasSession(chatId)) {
      this.aggregator.addStep(chatId, toolInfo.toolName, toolInfo.toolId, input);

      // For high visibility tools with workers enabled, still handle diff specially
      const visibility = getToolVisibilityLevel(toolInfo.toolName);
      if (visibility === 'high' && this.config.workers.enabled &&
          (toolInfo.toolName === TargetTool.Edit || toolInfo.toolName === TargetTool.MultiEdit || toolInfo.toolName === TargetTool.Write)) {
        await this.handleDiffToolUse(chatId, message, toolInfo, user, parentToolUseId, input);
      }
      return;
    }

    // Fallback to legacy behavior when aggregation is not active
    // Check if this is an Edit, MultiEdit, or Write tool and workers is enabled
    if (this.config.workers.enabled && (toolInfo.toolName === TargetTool.Edit || toolInfo.toolName === TargetTool.MultiEdit || toolInfo.toolName === TargetTool.Write)) {
      await this.handleDiffToolUse(chatId, message, toolInfo, user, parentToolUseId, input);
      return;
    }

    await this.sendDefaultToolLoadingMessage(chatId, message, toolInfo, user, parentToolUseId);
  }

  async handleToolResult(chatId: number, message: any, toolInfo: ToolInfo, user: UserSessionModel, parentToolUseId?: string): Promise<void> {
    if (!user.sessionId) return;

    const toolResult = this.extractToolResult(message);

    // If aggregation is active, complete step in aggregator
    if (this.useAggregator && this.aggregator.hasSession(chatId)) {
      this.aggregator.completeStep(chatId, toolInfo.toolId, toolResult.content, toolResult.isError);

      // Still handle ExitPlanMode specially
      if (toolInfo.toolName === TargetTool.ExitPlanMode && !toolResult.isError) {
        user.setPermissionMode(PermissionMode.Default);
        await this.storage.saveUserSession(user);
        await this.abortAndContinue(chatId);
      }
      return;
    }

    // Fallback to legacy behavior
    const storedTool = await this.storage.getToolUse(user.sessionId, toolInfo.toolId);
    if (!storedTool) return;

    // Special handling for ExitPlanMode
    if (storedTool.name === TargetTool.ExitPlanMode && !toolResult.isError) {
      // Switch permission mode to default
      user.setPermissionMode(PermissionMode.Default);
      await this.storage.saveUserSession(user);

      // Abort current request and send continue message
      await this.abortAndContinue(chatId);
      return;
    }

    await this.updateToolResultMessage(chatId, storedTool, toolResult, user.sessionId, toolInfo.toolId, parentToolUseId);
  }



  private async sendDefaultToolLoadingMessage(chatId: number, message: any, toolInfo: ToolInfo, user: UserSessionModel, parentToolUseId?: string): Promise<void> {
    const loadingMessage = await this.getToolLoadingMessage(toolInfo.toolName, message);
    await this.sendToolLoadingMessage(chatId, loadingMessage, toolInfo, user, parentToolUseId);
  }

  private async getToolLoadingMessage(toolName: string, message: any, rawDiff: boolean = true): Promise<string> {
    const targetTools = Object.values(TargetTool);

    if (!targetTools.includes(toolName as TargetTool)) {
      return `🔧 **Tool use**: \`${toolName}\`\n`;
    }

    // Extract input parameters from message
    let input: any = null;
    if (message.message?.content) {
      for (const content of message.message.content) {
        if (content.type === 'tool_use' && content.name === toolName) {
          input = content.input;
          break;
        }
      }
    }

    return await this.formatter.formatToolUse(toolName, input, rawDiff);
  }

  private extractToolInput(message: any, toolName: string): any {
    if (!message.message?.content) return null;

    for (const content of message.message.content) {
      if (content.type === 'tool_use' && content.name === toolName) {
        return content.input;
      }
    }
    return null;
  }

  private async sendToolLoadingMessage(chatId: number, loadingMessage: string, toolInfo: ToolInfo, user: UserSessionModel, parentToolUseId?: string): Promise<void> {
    if (!user.sessionId) return;

    if (toolInfo.toolName === TargetTool.Edit || toolInfo.toolName === TargetTool.MultiEdit) {
      loadingMessage = loadingMessage.replace(/```\n@@/g, '```diff\n@@');
    }

    const appendedToParent = await this.tryAppendToParentMessage(chatId, loadingMessage, toolInfo, user.sessionId, parentToolUseId);
    if (appendedToParent) return;

    // Default behavior: create new message
    const sentMessage = await this.telegramSender.safeSendMessage(chatId, loadingMessage);

    await this.storage.storeToolUse(user.sessionId, toolInfo.toolId, {
      name: toolInfo.toolName,
      messageId: sentMessage.message_id,
      originalMessage: loadingMessage,
      chatId: chatId.toString()
    });
  }

  private async tryAppendToParentMessage(chatId: number, loadingMessage: string, toolInfo: ToolInfo, sessionId: string, parentToolUseId?: string): Promise<boolean> {
    if (!parentToolUseId) return false;

    const parentTool = await this.storage.getToolUse(sessionId, parentToolUseId);
    if (!parentTool) return false;

    const updatedMessage = parentTool.originalMessage + '\n' + loadingMessage;
    try {
      const newMessage = await this.telegramSender.safeEditMessage(chatId, parentTool.messageId, updatedMessage);
      // Store this tool with the final message ID
      await this.storage.storeToolUse(sessionId, toolInfo.toolId, {
        name: toolInfo.toolName,
        messageId: newMessage.message_id,
        originalMessage: loadingMessage,
        chatId: chatId.toString(),
        parentToolUseId: parentToolUseId
      });
      return true;
    } catch (error) {
      console.error('Error updating parent tool message:', error);
      return false;
    }
  }

  private async updateToolResultMessage(chatId: number, storedTool: ToolData, toolResult: { content: any; isError: boolean }, sessionId: string, toolId: string, parentToolUseId?: string): Promise<void> {
    const resultText = this.formatter.formatToolResult(storedTool.name, toolResult.content, toolResult.isError);

    const updatedParent = await this.tryUpdateParentWithResult(chatId, storedTool, resultText, sessionId, toolId, parentToolUseId);
    if (updatedParent) return;

    // Default behavior: update the current tool's message
    await this.updateCurrentToolMessage(chatId, storedTool, resultText, sessionId, toolId);
  }

  private async tryUpdateParentWithResult(chatId: number, storedTool: ToolData, resultText: string, sessionId: string, toolId: string, parentToolUseId?: string): Promise<boolean> {
    if (!parentToolUseId) return false;

    const parentTool = await this.storage.getToolUse(sessionId, parentToolUseId);
    if (!parentTool) return false;

    // Update the parent's message to include this tool's result
    const updatedParentMessage = parentTool.originalMessage + storedTool.originalMessage.trimEnd() + ' ' + resultText.trimStart();

    try {
      const editedMessage = await this.telegramSender.safeEditMessage(chatId, parentTool.messageId, updatedParentMessage);

      // Update parent tool's stored message with potentially new message ID
      await this.storage.storeToolUse(sessionId, parentToolUseId, {
        ...parentTool,
        messageId: editedMessage.message_id,
        originalMessage: updatedParentMessage
      });

      // Delete the current tool since it's merged with parent
      await this.storage.deleteToolUse(sessionId, toolId);
      return true;
    } catch (error) {
      console.error('Error updating parent tool message:', error);
      return false;
    }
  }

  private async updateCurrentToolMessage(chatId: number, storedTool: ToolData, resultText: string, sessionId: string, toolId: string): Promise<void> {
    const combinedMessage = storedTool.originalMessage + '\n' + resultText;

    try {
      let keyboard = Markup.inlineKeyboard([]);
      if (storedTool.diffId) {
        const miniAppUrl = `${this.config.workers.endpoint}/diff?id=${storedTool.diffId}`;

        keyboard = Markup.inlineKeyboard([
          Markup.button.webApp('📊 View Diff', miniAppUrl)
        ]);
      }
      await this.telegramSender.safeEditMessage(chatId, storedTool.messageId, combinedMessage, { ...keyboard });

      await this.storage.deleteToolUse(sessionId, toolId);
    } catch (error) {
      console.error('Error updating tool message:', error);
      await this.telegramSender.safeSendMessage(chatId, combinedMessage);
    }
  }

  private extractToolResult(message: any): { content: any; isError: boolean } {
    if (message.message?.content) {
      for (const content of message.message.content) {
        if (content.type === 'tool_result') {
          return {
            content: content.content,
            isError: content.is_error || false
          };
        }
      }
    }
    return { content: '', isError: false };
  }

  private async handleDiffToolUse(chatId: number, message: any, toolInfo: ToolInfo, user: UserSessionModel, parentToolUseId: string | undefined, input: any): Promise<void> {

    try {
      // Generate diff patch from input
      const diffPatch = await this.generateDiffPatch(toolInfo.toolName, input);
      if (!diffPatch) {
        // Fall back to regular tool handling if no diff can be generated
        await this.sendDefaultToolLoadingMessage(chatId, message, toolInfo, user, parentToolUseId);
        return;
      }
      // Upload diff to worker
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      if (this.config.workers.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.workers.apiKey}`;
      }

      const response = await fetch(`${this.config.workers.endpoint}/api/diff`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          content: diffPatch,
          chatid: chatId.toString()
        })
      });

      if (!response.ok) {
        console.error('Failed to upload diff to worker:', response.statusText);
        // Fall back to regular tool handling
        await this.sendDefaultToolLoadingMessage(chatId, message, toolInfo, user, parentToolUseId);
        return;
      }

      const result = await response.json() as { id: string };
      const miniAppUrl = `${this.config.workers.endpoint}/diff?id=${result.id}`;

      // Create inline keyboard with diff viewer link
      const keyboard = Markup.inlineKeyboard([
        Markup.button.webApp('📊 View Diff', miniAppUrl)
      ]);

      const loadingMessage = await this.getToolLoadingMessage(toolInfo.toolName, message, false);
      const sentMessage = await this.telegramSender.safeSendMessage(chatId, loadingMessage, { ...keyboard });

      if (user.sessionId) {
        await this.storage.storeToolUse(user.sessionId, toolInfo.toolId, {
          name: toolInfo.toolName,
          messageId: sentMessage.message_id,
          originalMessage: loadingMessage,
          chatId: chatId.toString(),
          diffId: result.id,
        });
      }
    } catch (error) {
      console.error('Error handling diff tool use:', error);
      // Fall back to regular tool handling
      await this.sendDefaultToolLoadingMessage(chatId, message, toolInfo, user, parentToolUseId);
    }
  }

  private async generateDiffPatch(toolName: string, input: any): Promise<string | null> {
    if (toolName === TargetTool.Edit) {
      if (!input.file_path || !input.old_string || !input.new_string) {
        return null;
      }

      const diffText = this.formatter.formatEditAsDiff(input.file_path, input.old_string, input.new_string, false);
      // Remove markdown formatting for raw patch
      return diffText.replace(/```diff\n/, '').replace(/```$/, '');
    }

    if (toolName === TargetTool.MultiEdit) {
      if (!input.file_path || !input.edits || !Array.isArray(input.edits)) {
        return null;
      }

      try {
        const diffText = await this.formatter.formatMultiEditResult(input.file_path, input.edits, false);
        // Remove markdown formatting for raw patch
        return diffText.replace(/```diff\n/, '').replace(/```$/, '');
      } catch (error) {
        console.error('Error generating MultiEdit diff:', error);
        return null;
      }
    }

    if (toolName === TargetTool.Write) {
      if (!input.file_path || !input.content) {
        return null;
      }

      // For Write tool, generate diff showing the new file content
      const diffText = this.formatter.formatEditAsDiff(input.file_path, '', input.content, false);
      // Remove markdown formatting for raw patch
      return diffText.replace(/```diff\n/, '').replace(/```$/, '');
    }

    return null;
  }

  private async abortAndContinue(chatId: number): Promise<void> {
    if (this.claudeManager) {
      // Abort the current request
      await this.claudeManager.abortQuery(chatId);
      
      // Send a continue message
      await this.claudeManager.addMessageToStream(chatId, 'continue');
    }
  }
}