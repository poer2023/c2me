/**
 * MessageStore service for capturing and managing chat messages
 * Used by the Message Simulator feature in the Desktop app
 */

import { IStorage } from '../storage/interface';
import {
  ChatMessage,
  ChatSummary,
  createIncomingMessage,
  createOutgoingMessage,
} from '../models/chat-message';

export type MessageSubscriber = (message: ChatMessage) => void;

export class MessageStore {
  private storage: IStorage;
  private subscribers: Set<MessageSubscriber> = new Set();

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  /**
   * Capture an incoming message from a user
   */
  async captureIncoming(
    chatId: number,
    content: string,
    contentType: ChatMessage['contentType'] = 'text',
    metadata?: ChatMessage['metadata']
  ): Promise<void> {
    const message = createIncomingMessage(chatId, content, contentType, metadata);
    await this.saveAndNotify(message);
  }

  /**
   * Capture an outgoing message (bot response)
   */
  async captureOutgoing(
    chatId: number,
    content: string,
    contentType: ChatMessage['contentType'] = 'text',
    metadata?: ChatMessage['metadata']
  ): Promise<void> {
    const message = createOutgoingMessage(chatId, content, contentType, metadata);
    await this.saveAndNotify(message);
  }

  /**
   * Save message to storage and notify subscribers
   */
  private async saveAndNotify(message: ChatMessage): Promise<void> {
    try {
      await this.storage.saveChatMessage(message);

      // Notify all subscribers (for SSE real-time updates)
      for (const subscriber of this.subscribers) {
        try {
          subscriber(message);
        } catch (error) {
          console.error('Error notifying message subscriber:', error);
        }
      }
    } catch (error) {
      console.error('Error saving chat message:', error);
    }
  }

  /**
   * Subscribe to new messages (for SSE streaming)
   * Returns an unsubscribe function
   */
  subscribe(callback: MessageSubscriber): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Get message history for a chat
   */
  async getMessages(chatId: number, limit?: number, before?: number): Promise<ChatMessage[]> {
    return this.storage.getChatMessages(chatId, limit, before);
  }

  /**
   * Get recent chats with summaries
   */
  async getChats(limit?: number): Promise<ChatSummary[]> {
    return this.storage.getRecentChats(limit);
  }

  /**
   * Get subscriber count (for monitoring)
   */
  getSubscriberCount(): number {
    return this.subscribers.size;
  }
}

// Singleton instance (will be initialized in main.ts)
let messageStoreInstance: MessageStore | null = null;

export function initMessageStore(storage: IStorage): MessageStore {
  messageStoreInstance = new MessageStore(storage);
  return messageStoreInstance;
}

export function getMessageStore(): MessageStore | null {
  return messageStoreInstance;
}
