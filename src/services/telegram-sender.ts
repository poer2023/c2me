import { Telegraf } from 'telegraf';
import { splitMessage } from '@gramio/split';
import { getFormattable } from '@gramio/format';
import type { MessageEntity as TelegramMessageEntity }
  from 'telegraf/types';
import { markdownToTelegramEntities, MessageEntity } from './markdownToTelegramEntities';
import { incrementCounter, startTiming } from '../utils/metrics';
import { getMessageStore } from './message-store';

export class TelegramSender {
  constructor(private bot: Telegraf) { }

  async safeSendMessage(chatId: number, message: string, options: Record<string, unknown> = {}): Promise<{ message_id: number }> {
    const limit = 4096;
    const stopTimer = startTiming('telegram_send_time');

    // Capture outgoing message for Message Simulator
    const messageStore = getMessageStore();
    if (messageStore) {
      await messageStore.captureOutgoing(chatId, message, 'text');
    }

    let lastMessage: { message_id: number } | undefined;
    const parsed = markdownToTelegramEntities(message);

    const botEntities = parsed.entities
      .map(convert)
      .filter(Boolean) as TelegramMessageEntity[];

    const msg = getFormattable(parsed.text);
    msg.entities = botEntities;

    await splitMessage(
      msg,
      async ({ text, entities }) => {
        lastMessage = await this.bot.telegram.sendMessage(chatId, text, {
          entities: entities as TelegramMessageEntity[],
          ...options
        });
        incrementCounter('messages_sent');
        return lastMessage;
      },
      limit
    );

    stopTimer();

    // Ensure we always return a valid message_id
    // splitMessage should always call the callback at least once for non-empty messages
    if (!lastMessage) {
      throw new Error('Failed to send message: no message was sent');
    }
    return lastMessage;
  }

  async safeEditMessage(chatId: number, messageId: number, message: string, options: Record<string, unknown> = {}): Promise<{ message_id: number }> {
    const limit = 4096;
    const parsed = markdownToTelegramEntities(message);
    const botEntities = parsed.entities
      .map(convert)
      .filter(Boolean) as TelegramMessageEntity[];

    // For edit, we can only edit the first message, so we truncate if needed
    if (message.length <= limit) {
      await this.bot.telegram.editMessageText(
        chatId,
        messageId,
        undefined,
        parsed.text,
        {
          entities: botEntities,
          ...options
        }
      );
      return { message_id: messageId }; // Return the edited message
    } else {
      // If too long for edit, delete old message and send new split messages
      await this.bot.telegram.deleteMessage(chatId, messageId);

      // Use split to send new messages
      return await this.safeSendMessage(chatId, message, options);
    }
  }
}

const map: Record<string, string> = {
  messageEntityBold: 'bold',
  messageEntityItalic: 'italic',
  messageEntityUnderline: 'underline',
  messageEntityStrike: 'strikethrough',
  messageEntitySpoiler: 'spoiler',
  messageEntityCode: 'code',
  messageEntityPre: 'pre',
  messageEntityTextUrl: 'text_link',
  messageEntityMentionName: 'text_mention',
  messageEntityUrl: 'url',
  messageEntityHashtag: 'hashtag',
  messageEntityCashtag: 'cashtag',
  messageEntityBotCommand: 'bot_command',
  messageEntityPhone: 'phone_number',
  messageEntityEmail: 'email',
  messageEntityCustomEmoji: 'custom_emoji',
  messageEntityBlockquote: 'blockquote',
  messageEntityExpandableBlockquote: 'expandable_blockquote',
};

function convert(
  e: MessageEntity,
): TelegramMessageEntity | null {
  const type = map[e.type];
  if (!type) return null;
  const base = {
    type,
    offset: e.offset,
    length: e.length,
  } as TelegramMessageEntity;

  if (type === 'text_link' && 'url' in e) (base as TelegramMessageEntity & { url: string }).url = e.url;
  if (type === 'pre' && 'language' in e) (base as TelegramMessageEntity & { language: string }).language = e.language;
  if (type === 'text_mention' && 'user' in e) (base as TelegramMessageEntity & { user: unknown }).user = (e as MessageEntity & { user: unknown }).user;

  return base;
}