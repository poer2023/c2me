/**
 * MessageSimulator component - Telegram-style message viewer
 * Displays real-time messages between bot and users
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { ChatList, ChatSummary } from './chat/ChatList';
import { MessageBubble, ChatMessage } from './chat/MessageBubble';
import { useSettings } from '../contexts/SettingsContext';
import './MessageSimulator.css';

interface MessageSimulatorProps {
  isRunning: boolean;
  apiBaseUrl?: string;
}

export function MessageSimulator({ isRunning, apiBaseUrl = 'http://localhost:3000' }: MessageSimulatorProps) {
  const { t } = useSettings();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Fetch chat list
  const fetchChats = useCallback(async () => {
    if (!isRunning) return;

    try {
      const response = await fetch(`${apiBaseUrl}/api/chats`);
      if (!response.ok) throw new Error('Failed to fetch chats');
      const data = await response.json();
      setChats(data);
    } catch (err) {
      console.error('Error fetching chats:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch chats');
    }
  }, [apiBaseUrl, isRunning]);

  // Fetch messages for selected chat
  const fetchMessages = useCallback(async (chatId: number) => {
    if (!isRunning) return;

    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/messages/${chatId}?limit=100`);
      if (!response.ok) throw new Error('Failed to fetch messages');
      const data = await response.json();
      setMessages(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching messages:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch messages');
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, isRunning]);

  // Connect to SSE stream for real-time updates
  useEffect(() => {
    if (!isRunning) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    const eventSource = new EventSource(`${apiBaseUrl}/api/stream`);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('message', (event) => {
      try {
        const message: ChatMessage = JSON.parse(event.data);

        // Update messages if this is for the selected chat
        if (message.chatId === selectedChatId) {
          setMessages(prev => [...prev, message]);
        }

        // Refresh chat list to update last message
        fetchChats();
      } catch (err) {
        console.error('Error parsing SSE message:', err);
      }
    });

    eventSource.addEventListener('error', () => {
      console.error('SSE connection error');
      // EventSource will automatically reconnect
    });

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [apiBaseUrl, isRunning, selectedChatId, fetchChats]);

  // Initial fetch
  useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  // Fetch messages when chat is selected
  useEffect(() => {
    if (selectedChatId) {
      fetchMessages(selectedChatId);
    }
  }, [selectedChatId, fetchMessages]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Poll for chat updates every 10 seconds
  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(fetchChats, 10000);
    return () => clearInterval(interval);
  }, [isRunning, fetchChats]);

  const handleSelectChat = (chatId: number) => {
    setSelectedChatId(chatId);
    setMessages([]);
  };

  if (!isRunning) {
    return (
      <div className="message-simulator">
        <div className="simulator-offline">
          <div className="offline-icon">📴</div>
          <p>{t('messages.botOffline')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="message-simulator">
      <div className="chat-sidebar">
        <div className="sidebar-header">
          <h3>{t('messages.title')}</h3>
          <button className="refresh-btn" onClick={fetchChats} title="Refresh">
            🔄
          </button>
        </div>
        <ChatList
          chats={chats}
          selectedChatId={selectedChatId}
          onSelectChat={handleSelectChat}
        />
      </div>

      <div className="chat-main">
        {selectedChatId ? (
          <>
            <div className="chat-header">
              <div className="chat-header-info">
                {chats.find(c => c.chatId === selectedChatId)?.firstName ||
                  chats.find(c => c.chatId === selectedChatId)?.username ||
                  `Chat ${selectedChatId}`}
              </div>
            </div>

            <div className="messages-container">
              {loading ? (
                <div className="messages-loading">
                  <div className="loading-spinner" />
                </div>
              ) : error ? (
                <div className="messages-error">
                  <p>{error}</p>
                  <button onClick={() => fetchMessages(selectedChatId)}>
                    {t('messages.retry')}
                  </button>
                </div>
              ) : messages.length === 0 ? (
                <div className="messages-empty">
                  <p>{t('messages.noMessages')}</p>
                </div>
              ) : (
                <>
                  {messages.map((message) => (
                    <MessageBubble key={message.id} message={message} />
                  ))}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>
          </>
        ) : (
          <div className="no-chat-selected">
            <div className="no-chat-icon">💬</div>
            <p>{t('messages.selectChat')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
