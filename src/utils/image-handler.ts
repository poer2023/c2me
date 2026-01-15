/**
 * Image Handler Utility
 *
 * Handles downloading images from Telegram and converting to base64 for Claude.
 */

import { Telegraf } from 'telegraf';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

export interface ImageContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    data: string;
  };
}

export interface TextContent {
  type: 'text';
  text: string;
}

export type MessageContent = ImageContent | TextContent;

/**
 * Download a file from Telegram servers
 */
async function downloadFile(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Handle redirect
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          downloadFile(redirectUrl).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download file: ${response.statusCode}`));
        return;
      }

      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Get media type from file path
 */
function getMediaType(filePath: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.jpg':
    case '.jpeg':
    default:
      return 'image/jpeg';
  }
}

/**
 * Download image from Telegram and convert to base64 content block
 */
export async function downloadTelegramImage(
  bot: Telegraf,
  fileId: string
): Promise<ImageContent> {
  // Get file info from Telegram
  const file = await bot.telegram.getFile(fileId);

  if (!file.file_path) {
    throw new Error('File path not available from Telegram');
  }

  // Construct download URL
  const token = (bot.telegram as any).token;
  const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

  // Download the file
  const buffer = await downloadFile(fileUrl);

  // Convert to base64
  const base64Data = buffer.toString('base64');
  const mediaType = getMediaType(file.file_path);

  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mediaType,
      data: base64Data,
    },
  };
}

/**
 * Save image to local file (optional, for debugging)
 */
export async function saveImageLocally(
  bot: Telegraf,
  fileId: string,
  outputDir: string
): Promise<string> {
  // Get file info from Telegram
  const file = await bot.telegram.getFile(fileId);

  if (!file.file_path) {
    throw new Error('File path not available from Telegram');
  }

  // Construct download URL
  const token = (bot.telegram as any).token;
  const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

  // Download the file
  const buffer = await downloadFile(fileUrl);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Generate output filename
  const ext = path.extname(file.file_path) || '.jpg';
  const filename = `${Date.now()}_${fileId.slice(-8)}${ext}`;
  const outputPath = path.join(outputDir, filename);

  // Write file
  fs.writeFileSync(outputPath, buffer);

  return outputPath;
}

/**
 * Build message content array with optional images and text
 */
export function buildMessageContent(
  text?: string,
  images?: ImageContent[]
): MessageContent[] {
  const content: MessageContent[] = [];

  // Add images first (Claude expects images before text for best results)
  if (images && images.length > 0) {
    content.push(...images);
  }

  // Add text
  if (text) {
    content.push({
      type: 'text',
      text: text,
    });
  }

  return content;
}
