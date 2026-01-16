/**
 * Chat message model for storing Telegram conversation history
 */

export interface ChatMessage {
  id: string;                    // UUID
  chatId: number;                // Telegram chat ID
  direction: 'incoming' | 'outgoing';
  senderType: 'user' | 'bot';
  content: string;               // Message text
  contentType: 'text' | 'photo' | 'document' | 'tool_use' | 'tool_result';
  timestamp: number;             // Unix timestamp ms
  metadata?: {
    username?: string | undefined;
    firstName?: string | undefined;
    lastName?: string | undefined;
    fileName?: string | undefined;
    toolName?: string | undefined;
    messageId?: number | undefined;
  } | undefined;
}

export interface ChatSummary {
  chatId: number;
  username?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  lastMessage: string;
  lastMessageTime: number;
  unreadCount: number;
}

/**
 * Helper to generate a unique message ID
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a new incoming chat message
 */
export function createIncomingMessage(
  chatId: number,
  content: string,
  contentType: ChatMessage['contentType'] = 'text',
  metadata?: ChatMessage['metadata']
): ChatMessage {
  return {
    id: generateMessageId(),
    chatId,
    direction: 'incoming',
    senderType: 'user',
    content,
    contentType,
    timestamp: Date.now(),
    metadata,
  };
}

/**
 * Create a new outgoing chat message (bot response)
 */
export function createOutgoingMessage(
  chatId: number,
  content: string,
  contentType: ChatMessage['contentType'] = 'text',
  metadata?: ChatMessage['metadata']
): ChatMessage {
  return {
    id: generateMessageId(),
    chatId,
    direction: 'outgoing',
    senderType: 'bot',
    content,
    contentType,
    timestamp: Date.now(),
    metadata,
  };
}
