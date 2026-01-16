/**
 * Message API routes for the Message Simulator feature
 * Provides REST endpoints for fetching chat messages and SSE streaming
 */

import { Router, Request, Response } from 'express';
import { getMessageStore } from '../services/message-store';

export function createMessageRoutes(): Router {
  const router = Router();

  /**
   * GET /api/chats - List recent chats with summaries
   */
  router.get('/chats', async (_req: Request, res: Response) => {
    try {
      const messageStore = getMessageStore();
      if (!messageStore) {
        res.status(503).json({ error: 'Message store not initialized' });
        return;
      }

      const limit = parseInt(_req.query.limit as string) || 50;
      const chats = await messageStore.getChats(limit);
      res.json(chats);
    } catch (error) {
      console.error('Failed to get chats:', error);
      res.status(500).json({ error: 'Failed to get chats' });
    }
  });

  /**
   * GET /api/messages/:chatId - Get message history for a specific chat
   */
  router.get('/messages/:chatId', async (req: Request, res: Response) => {
    try {
      const messageStore = getMessageStore();
      if (!messageStore) {
        res.status(503).json({ error: 'Message store not initialized' });
        return;
      }

      const chatIdParam = req.params.chatId;
      if (!chatIdParam) {
        res.status(400).json({ error: 'Chat ID is required' });
        return;
      }
      const chatId = parseInt(chatIdParam);
      if (isNaN(chatId)) {
        res.status(400).json({ error: 'Invalid chat ID' });
        return;
      }

      const limit = parseInt(req.query.limit as string) || 50;
      const beforeParam = req.query.before as string | undefined;
      const before = beforeParam ? parseInt(beforeParam) : undefined;

      const messages = await messageStore.getMessages(chatId, limit, before);
      res.json(messages);
    } catch (error) {
      console.error('Failed to get messages:', error);
      res.status(500).json({ error: 'Failed to get messages' });
    }
  });

  /**
   * GET /api/messages/stream - SSE endpoint for real-time message updates
   */
  router.get('/stream', (req: Request, res: Response) => {
    const messageStore = getMessageStore();
    if (!messageStore) {
      res.status(503).json({ error: 'Message store not initialized' });
      return;
    }

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Send initial connection message
    res.write('event: connected\n');
    res.write(`data: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);

    // Subscribe to new messages
    const unsubscribe = messageStore.subscribe((message) => {
      try {
        res.write('event: message\n');
        res.write(`data: ${JSON.stringify(message)}\n\n`);
      } catch (error) {
        console.error('Error sending SSE message:', error);
      }
    });

    // Send heartbeat every 30 seconds to keep connection alive
    const heartbeatInterval = setInterval(() => {
      try {
        res.write('event: heartbeat\n');
        res.write(`data: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
      } catch (error) {
        console.error('Error sending heartbeat:', error);
        clearInterval(heartbeatInterval);
      }
    }, 30000);

    // Cleanup on connection close
    req.on('close', () => {
      clearInterval(heartbeatInterval);
      unsubscribe();
    });
  });

  return router;
}
