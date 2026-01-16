/**
 * MessageBubble component - displays individual message in Telegram style
 */

export interface ChatMessage {
  id: string;
  chatId: number;
  direction: 'incoming' | 'outgoing';
  senderType: 'user' | 'bot';
  content: string;
  contentType: 'text' | 'photo' | 'document' | 'tool_use' | 'tool_result';
  timestamp: number;
  metadata?: {
    username?: string;
    firstName?: string;
    lastName?: string;
    fileName?: string;
    toolName?: string;
    messageId?: number;
  };
}

interface MessageBubbleProps {
  message: ChatMessage;
  showAvatar?: boolean;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getContentTypeIcon(contentType: ChatMessage['contentType']): string {
  switch (contentType) {
    case 'photo':
      return '🖼️';
    case 'document':
      return '📄';
    case 'tool_use':
      return '🔧';
    case 'tool_result':
      return '✅';
    default:
      return '';
  }
}

export function MessageBubble({ message, showAvatar = true }: MessageBubbleProps) {
  const isOutgoing = message.direction === 'outgoing';
  const icon = getContentTypeIcon(message.contentType);

  return (
    <div className={`message-row ${isOutgoing ? 'outgoing' : 'incoming'}`}>
      {!isOutgoing && showAvatar && (
        <div className="message-avatar">
          {message.metadata?.firstName?.charAt(0).toUpperCase() || '👤'}
        </div>
      )}
      <div className={`message-bubble ${isOutgoing ? 'bot' : 'user'}`}>
        {icon && <span className="message-type-icon">{icon}</span>}
        <div className="message-content">
          {message.contentType === 'document' && message.metadata?.fileName && (
            <div className="message-file-name">{message.metadata.fileName}</div>
          )}
          {message.contentType === 'tool_use' && message.metadata?.toolName && (
            <div className="message-tool-name">Tool: {message.metadata.toolName}</div>
          )}
          <span className="message-text">{message.content}</span>
        </div>
        <div className="message-meta">
          <span className="message-time">{formatTime(message.timestamp)}</span>
          {isOutgoing && <span className="message-status">✓</span>}
        </div>
      </div>
      {isOutgoing && showAvatar && (
        <div className="message-avatar bot-avatar">🤖</div>
      )}
    </div>
  );
}
