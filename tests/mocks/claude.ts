/**
 * Mock for Claude Code SDK
 */

import { vi } from 'vitest';

export interface MockClaudeMessage {
  type: 'assistant' | 'user' | 'result';
  message?: {
    content: Array<{
      type: 'text' | 'tool_use' | 'tool_result';
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
    model?: string;
    stop_reason?: string;
  };
}

export interface MockToolUse {
  toolId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export function createMockTextMessage(text: string): MockClaudeMessage {
  return {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text }],
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
    },
  };
}

export function createMockToolUseMessage(
  toolName: string,
  toolId: string,
  input: Record<string, unknown>
): MockClaudeMessage {
  return {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: toolId,
          name: toolName,
          input,
        },
      ],
      model: 'claude-sonnet-4-20250514',
    },
  };
}

export function createMockToolResultMessage(
  toolId: string,
  result: string
): MockClaudeMessage {
  return {
    type: 'result',
    message: {
      content: [
        {
          type: 'tool_result',
          id: toolId,
          text: result,
        },
      ],
    },
  };
}

export function createMockClaudeManager() {
  const streams = new Map<number, {
    messages: MockClaudeMessage[];
    callback: (msg: MockClaudeMessage) => void;
  }>();

  return {
    startStream: vi.fn().mockImplementation((chatId: number, _projectPath: string) => {
      streams.set(chatId, { messages: [], callback: () => {} });
      return Promise.resolve('session-' + chatId);
    }),

    addMessageToStream: vi.fn().mockImplementation((chatId: number, text: string) => {
      const stream = streams.get(chatId);
      if (stream) {
        // Simulate async response
        setTimeout(() => {
          stream.callback(createMockTextMessage(`Response to: ${text}`));
        }, 10);
      }
      return Promise.resolve();
    }),

    resumeStream: vi.fn().mockResolvedValue(undefined),

    stopStream: vi.fn().mockImplementation((chatId: number) => {
      streams.delete(chatId);
      return Promise.resolve();
    }),

    handleToolApproval: vi.fn().mockResolvedValue(undefined),
    handleToolRejection: vi.fn().mockResolvedValue(undefined),

    setResponseCallback: vi.fn().mockImplementation((callback: (chatId: number, msg: MockClaudeMessage) => void) => {
      // Store callback for use in tests
    }),

    isStreamActive: vi.fn().mockImplementation((chatId: number) => {
      return streams.has(chatId);
    }),

    // Test helpers
    _simulateResponse: (chatId: number, message: MockClaudeMessage) => {
      const stream = streams.get(chatId);
      if (stream) {
        stream.callback(message);
      }
    },

    _simulateToolUse: (chatId: number, toolName: string, input: Record<string, unknown>) => {
      const toolId = 'tool-' + Date.now();
      const stream = streams.get(chatId);
      if (stream) {
        stream.callback(createMockToolUseMessage(toolName, toolId, input));
      }
      return toolId;
    },
  };
}

export const MOCK_TOOLS = {
  Read: {
    name: 'Read',
    input: { file_path: '/path/to/file.ts' },
  },
  Edit: {
    name: 'Edit',
    input: {
      file_path: '/path/to/file.ts',
      old_string: 'old code',
      new_string: 'new code',
    },
  },
  Write: {
    name: 'Write',
    input: {
      file_path: '/path/to/new-file.ts',
      content: 'file content',
    },
  },
  Bash: {
    name: 'Bash',
    input: {
      command: 'npm test',
    },
  },
  Grep: {
    name: 'Grep',
    input: {
      pattern: 'searchPattern',
      path: '/path/to/search',
    },
  },
};
