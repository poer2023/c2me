/**
 * Mock for Telegram Bot API (Telegraf)
 */

import { vi } from 'vitest';

export interface MockMessage {
  message_id: number;
  chat: {
    id: number;
    type: 'private' | 'group' | 'supergroup' | 'channel';
  };
  from?: {
    id: number;
    first_name: string;
    username?: string;
  };
  text?: string;
  date: number;
}

export interface MockContext {
  message: MockMessage;
  chat: MockMessage['chat'];
  from: MockMessage['from'];
  reply: ReturnType<typeof vi.fn>;
  replyWithMarkdown: ReturnType<typeof vi.fn>;
  editMessageText: ReturnType<typeof vi.fn>;
  deleteMessage: ReturnType<typeof vi.fn>;
  answerCbQuery: ReturnType<typeof vi.fn>;
}

export function createMockMessage(overrides: Partial<MockMessage> = {}): MockMessage {
  return {
    message_id: 1,
    chat: {
      id: 12345,
      type: 'private',
    },
    from: {
      id: 12345,
      first_name: 'Test User',
      username: 'testuser',
    },
    text: 'Test message',
    date: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

export function createMockContext(overrides: Partial<MockMessage> = {}): MockContext {
  const message = createMockMessage(overrides);

  return {
    message,
    chat: message.chat,
    from: message.from,
    reply: vi.fn().mockResolvedValue({ message_id: 2 }),
    replyWithMarkdown: vi.fn().mockResolvedValue({ message_id: 2 }),
    editMessageText: vi.fn().mockResolvedValue(true),
    deleteMessage: vi.fn().mockResolvedValue(true),
    answerCbQuery: vi.fn().mockResolvedValue(true),
  };
}

export function createMockBot() {
  return {
    telegram: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
      editMessageText: vi.fn().mockResolvedValue(true),
      deleteMessage: vi.fn().mockResolvedValue(true),
      sendChatAction: vi.fn().mockResolvedValue(true),
      getChat: vi.fn().mockResolvedValue({ id: 12345, type: 'private' }),
    },
    command: vi.fn(),
    on: vi.fn(),
    action: vi.fn(),
    launch: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

export function createCallbackQuery(data: string, messageId: number = 1) {
  return {
    id: 'callback-query-123',
    data,
    message: createMockMessage({ message_id: messageId }),
    from: {
      id: 12345,
      first_name: 'Test User',
    },
  };
}
