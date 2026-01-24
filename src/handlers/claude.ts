import { query, type Options, AbortError, type SDKUserMessage, type SDKMessage, type SDKAssistantMessage } from '@anthropic-ai/claude-agent-sdk';
import { IStorage } from '../storage/interface';
import { TargetTool } from '../models/types';
import { PermissionManager } from './permission-manager';
import { StreamManager } from '../utils/stream-manager';
import { incrementCounter, startTiming, incrementGauge, decrementGauge } from '../utils/metrics';
import { MessageContent } from '../utils/image-handler';
import { logger } from '../utils/logger';
import { UserSessionModel } from '../models/user-session';

/** Tool info extracted from SDK messages */
export interface ToolInfo {
  toolId: string;
  toolName: string;
  isToolUse: boolean;
  isToolResult: boolean;
}

/** Content block types from SDK messages */
interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | unknown[];
  is_error?: boolean;
}

type ContentBlock = { type: string } & Record<string, unknown>;

export class ClaudeManager {
  private storage: IStorage;
  private permissionManager: PermissionManager;
  private streamManager = new StreamManager();
  private binaryPath: string | undefined;
  private onClaudeResponse: (userId: string, message: SDKMessage | null, toolInfo?: ToolInfo, parentToolUseId?: string) => Promise<void>;
  private onClaudeError: (userId: string, error: string) => void;

  constructor(
    storage: IStorage,
    permissionManager: PermissionManager,
    callbacks: {
      onClaudeResponse: (userId: string, message: SDKMessage | null, toolInfo?: ToolInfo, parentToolUseId?: string) => Promise<void>;
      onClaudeError: (userId: string, error: string) => void;
    },
    binaryPath?: string
  ) {
    this.storage = storage;
    this.permissionManager = permissionManager;
    this.onClaudeResponse = callbacks.onClaudeResponse;
    this.onClaudeError = callbacks.onClaudeError;
    this.binaryPath = binaryPath;
  }

  async addMessageToStream(chatId: number, prompt: string): Promise<void> {
    const session = await this.storage.getUserSession(chatId);
    if (!session) {
      console.error(`[ClaudeManager] No session found for chatId: ${chatId}`);
      return;
    }

    const userMessage: SDKUserMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt
          }
        ]
      },
      parent_tool_use_id: null,
      session_id: ''
    };

    // If no active query, start a new one
    if (!this.streamManager.isStreamActive(chatId)) {
      await this.startNewQuery(chatId, session);
    }

    // Add message to existing stream
    this.streamManager.addMessage(chatId, userMessage);
  }

  /**
   * Add a message with mixed content (text and/or images) to the stream
   */
  async addMessageWithContent(chatId: number, content: MessageContent[]): Promise<void> {
    const session = await this.storage.getUserSession(chatId);
    if (!session) {
      console.error(`[ClaudeManager] No session found for chatId: ${chatId}`);
      return;
    }

    const userMessage: SDKUserMessage = {
      type: 'user',
      message: {
        role: 'user',
        // MessageContent[] is compatible with SDK content format
        content: content as SDKUserMessage['message']['content']
      },
      parent_tool_use_id: null,
      session_id: ''
    };

    // If no active query, start a new one
    if (!this.streamManager.isStreamActive(chatId)) {
      await this.startNewQuery(chatId, session);
    }

    // Add message to existing stream
    this.streamManager.addMessage(chatId, userMessage);
  }

  async sendMessage(chatId: number, prompt: AsyncIterable<SDKUserMessage>, options: Options): Promise<void> {
    const userSession = await this.storage.getUserSession(chatId);
    if (!userSession) {
      throw new Error('User session not found');
    }

    // Track metrics
    incrementCounter('claude_requests');
    incrementGauge('active_sessions');
    const stopTimer = startTiming('claude_response_time');

    try {
      for await (const message of query({
        prompt,
        options: options
      })) {
        if (message.session_id && userSession.sessionId !== message.session_id) {
          userSession.sessionId = message.session_id;
          await this.storage.saveUserSession(userSession);
        }

        // Phase 3: Use structured logger with lazy serialization (avoids JSON.stringify in production)
        logger.debug({ messageType: message.type, sessionId: message.session_id }, 'Claude SDK message received');

        // Detect tool use and tool result in message content
        const toolInfo = this.extractToolInfo(message);
        const parentToolUseId = 'parent_tool_use_id' in message ? (message.parent_tool_use_id as string | undefined) : undefined;

        // Track tool usage
        if (toolInfo?.isToolUse) {
          incrementCounter('tool_uses');
        }

        await this.onClaudeResponse(chatId.toString(), message, toolInfo, parentToolUseId);
      }

      // Track successful response
      incrementCounter('claude_responses');
    } catch (error) {
      // Track errors
      incrementCounter('errors');

      // Don't throw error if it's caused by abort
      if (error instanceof AbortError) {
        return;
      }

      this.onClaudeError?.(chatId.toString(), error instanceof Error ? error.message : 'Unknown error');
      throw error;
    } finally {
      // Stop timing and update gauges
      stopTimer();
      decrementGauge('active_sessions');

      // Signal completion with null message to indicate completion
      this.onClaudeResponse(chatId.toString(), null, undefined, undefined);
    }

    await this.storage.updateSessionActivity(userSession);
  }

  async abortQuery(chatId: number): Promise<boolean> {
    return this.streamManager.abortStream(chatId);
  }

  isQueryRunning(chatId: number): boolean {
    return this.streamManager.isStreamActive(chatId);
  }

  async shutdown(): Promise<void> {
    this.streamManager.shutdown();
    await this.storage.disconnect();
  }

  private extractToolInfo(message: SDKMessage): ToolInfo | undefined {
    const targetTools = Object.values(TargetTool);

    // Check if message has content array (only assistant and user messages have this)
    if (!('message' in message)) {
      return undefined;
    }

    const msgWithContent = message as SDKAssistantMessage | SDKUserMessage;
    if (!msgWithContent.message?.content || !Array.isArray(msgWithContent.message.content)) {
      return undefined;
    }

    // Check for tool_use in assistant messages
    if (message.type === 'assistant') {
      for (const block of msgWithContent.message.content as ContentBlock[]) {
        if (block.type === 'tool_use') {
          const toolBlock = block as unknown as ToolUseBlock;
          if (targetTools.includes(toolBlock.name as TargetTool)) {
            return {
              toolId: toolBlock.id,
              toolName: toolBlock.name,
              isToolUse: true,
              isToolResult: false
            };
          }
        }
      }
    }

    // Check for tool_result in user messages
    if (message.type === 'user') {
      for (const block of msgWithContent.message.content as ContentBlock[]) {
        if (block.type === 'tool_result') {
          const resultBlock = block as unknown as ToolResultBlock;
          if (resultBlock.tool_use_id) {
            return {
              toolId: resultBlock.tool_use_id,
              toolName: '', // We'll retrieve this from Redis
              isToolUse: false,
              isToolResult: true
            };
          }
        }
      }
    }

    return undefined;
  }

  private async startNewQuery(chatId: number, session: UserSessionModel): Promise<void> {
    const stream = this.streamManager.getOrCreateStream(chatId);
    const controller = this.streamManager.getController(chatId)!;
    
    const options: Options = {
      cwd: session.projectPath,
      ...(session.sessionId ? { resume: session.sessionId } : {}),
      ...(this.binaryPath ? { pathToClaudeCodeExecutable: this.binaryPath } : {}),
      abortController: controller,
      permissionMode: session.permissionMode,
      // New SDK requires explicit system prompt and settings configuration
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      settingSources: ['user', 'project', 'local'],
      canUseTool: async (toolName: string, input: Record<string, unknown>) => {
        try {
          // Inject chatId into input for PermissionManager use
          const inputWithChatId = { ...input, __chatId: chatId };
          const result = await this.permissionManager.canUseTool(toolName, inputWithChatId);
          return result;
        } catch (error) {
          return {
            behavior: 'deny',
            message: `Permission check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
          };
        }
      },
    };

    // Start query
    this.sendMessage(chatId, stream, options);
  }

}