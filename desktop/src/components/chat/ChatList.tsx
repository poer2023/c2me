/**
 * ChatList component - displays list of chats in sidebar
 */

import { useSettings } from '../../contexts/SettingsContext';

export interface ChatSummary {
  chatId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  lastMessage: string;
  lastMessageTime: number;
  unreadCount: number;
}

interface ChatListProps {
  chats: ChatSummary[];
  selectedChatId: number | null;
  onSelectChat: (chatId: number) => void;
}

function getInitials(chat: ChatSummary): string {
  if (chat.firstName) {
    return chat.firstName.charAt(0).toUpperCase();
  }
  if (chat.username) {
    return chat.username.charAt(0).toUpperCase();
  }
  return '#';
}

function getDisplayName(chat: ChatSummary): string {
  if (chat.firstName && chat.lastName) {
    return `${chat.firstName} ${chat.lastName}`;
  }
  if (chat.firstName) {
    return chat.firstName;
  }
  if (chat.username) {
    return `@${chat.username}`;
  }
  return `Chat ${chat.chatId}`;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (days === 1) {
    return 'Yesterday';
  } else if (days < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}

export function ChatList({ chats, selectedChatId, onSelectChat }: ChatListProps) {
  const { t } = useSettings();

  if (chats.length === 0) {
    return (
      <div className="chat-list-empty">
        <div className="empty-icon">💬</div>
        <p>{t('messages.noChats')}</p>
      </div>
    );
  }

  return (
    <div className="chat-list">
      {chats.map((chat) => (
        <div
          key={chat.chatId}
          className={`chat-item ${selectedChatId === chat.chatId ? 'selected' : ''}`}
          onClick={() => onSelectChat(chat.chatId)}
        >
          <div className="chat-avatar">
            {getInitials(chat)}
          </div>
          <div className="chat-info">
            <div className="chat-header">
              <span className="chat-name">{getDisplayName(chat)}</span>
              <span className="chat-time">{formatTime(chat.lastMessageTime)}</span>
            </div>
            <div className="chat-preview">
              <span className="chat-last-message">{chat.lastMessage}</span>
              {chat.unreadCount > 0 && (
                <span className="chat-unread">{chat.unreadCount}</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
