/**
 * Integration tests for Claude Code flow
 * Tests the message flow from user input through Claude SDK to Telegram response
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryStorage } from '../../src/storage/memory';
import { UserSessionModel } from '../../src/models/user-session';
import { UserState, PermissionMode } from '../../src/models/types';
import { MessageBatcher } from '../../src/queue/message-batcher';
import { createMockBot, createMockContext, createMockMessage } from '../mocks/telegram';
import { createMockClaudeManager, createMockTextMessage, MOCK_TOOLS } from '../mocks/claude';

describe('Claude Flow Integration', () => {
  let storage: MemoryStorage;
  let mockBot: ReturnType<typeof createMockBot>;
  let mockClaude: ReturnType<typeof createMockClaudeManager>;
  let messageBatcher: MessageBatcher;

  beforeEach(async () => {
    storage = new MemoryStorage();
    await storage.initialize();

    mockBot = createMockBot();
    mockClaude = createMockClaudeManager();

    messageBatcher = new MessageBatcher(async (chatId, message) => {
      await mockBot.telegram.sendMessage(chatId, message);
    });
  });

  describe('session lifecycle', () => {
    it('should create new session for new user', async () => {
      const chatId = 12345;
      let session = await storage.getUserSession(chatId);

      expect(session).toBeNull();

      // Create new session
      session = new UserSessionModel(chatId);
      await storage.saveUserSession(session);

      const retrieved = await storage.getUserSession(chatId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.chatId).toBe(chatId);
      expect(retrieved?.state).toBe(UserState.Idle);
    });

    it('should start claude session with project path', async () => {
      const chatId = 12345;
      const session = new UserSessionModel(chatId);

      await storage.startClaudeSession(session, 'session-123', '/project/path');

      expect(session.sessionId).toBe('session-123');
      expect(session.projectPath).toBe('/project/path');
      expect(session.active).toBe(true);
    });

    it('should end session and reset state', async () => {
      const chatId = 12345;
      const session = new UserSessionModel(chatId);

      session.startSession('session-123', '/project');
      session.setState(UserState.InSession);

      await storage.endClaudeSession(session);

      expect(session.sessionId).toBeUndefined();
      expect(session.active).toBe(false);
      expect(session.state).toBe(UserState.Idle);
    });
  });

  describe('message flow', () => {
    it('should send user message to claude and receive response', async () => {
      const chatId = 12345;

      // Start stream
      const sessionId = await mockClaude.startStream(chatId, '/project');
      expect(sessionId).toBe('session-12345');

      // Send message
      await mockClaude.addMessageToStream(chatId, 'Hello Claude');

      expect(mockClaude.addMessageToStream).toHaveBeenCalledWith(chatId, 'Hello Claude');
    });

    it('should batch multiple rapid messages', async () => {
      const chatId = 12345;

      messageBatcher.addMessage(chatId, 'Part 1');
      messageBatcher.addMessage(chatId, 'Part 2');
      messageBatcher.addMessage(chatId, 'Part 3');

      // Wait for batch processing
      await new Promise(r => setTimeout(r, 100));

      // Verify all messages were sent (may be in one or multiple batches)
      expect(mockBot.telegram.sendMessage).toHaveBeenCalled();

      // Collect all sent messages
      const calls = mockBot.telegram.sendMessage.mock.calls;
      const allMessages = calls.map((c: [number, string]) => c[1]).join('\n');
      expect(allMessages).toContain('Part 1');
      expect(allMessages).toContain('Part 2');
      expect(allMessages).toContain('Part 3');
    });

    it('should handle messages from different chats independently', async () => {
      messageBatcher.addMessage(111, 'Chat 1 message');
      messageBatcher.addMessage(222, 'Chat 2 message');

      await new Promise(r => setTimeout(r, 100));

      expect(mockBot.telegram.sendMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('permission modes', () => {
    it('should respect default permission mode', () => {
      const session = new UserSessionModel(12345);
      expect(session.getPermissionMode()).toBe(PermissionMode.Default);
    });

    it('should switch to accept edits mode', () => {
      const session = new UserSessionModel(12345);
      session.setPermissionMode(PermissionMode.AcceptEdits);

      expect(session.getPermissionMode()).toBe(PermissionMode.AcceptEdits);
    });

    it('should persist permission mode across session', async () => {
      const session = new UserSessionModel(12345);
      session.setPermissionMode(PermissionMode.BypassPermissions);

      await storage.saveUserSession(session);
      const retrieved = await storage.getUserSession(12345);

      expect(retrieved?.permissionMode).toBe(PermissionMode.BypassPermissions);
    });
  });

  describe('tool use handling', () => {
    it('should store tool use data', async () => {
      const toolData = {
        name: 'Edit',
        messageId: 100,
        originalMessage: 'Edit request',
        chatId: '12345',
      };

      await storage.storeToolUse('session-1', 'tool-abc', toolData);

      const retrieved = await storage.getToolUse('session-1', 'tool-abc');
      expect(retrieved?.name).toBe('Edit');
      expect(retrieved?.messageId).toBe(100);
    });

    it('should delete tool use after processing', async () => {
      await storage.storeToolUse('session-1', 'tool-abc', {
        name: 'Read',
        messageId: 101,
        originalMessage: 'Read request',
        chatId: '12345',
      });

      await storage.deleteToolUse('session-1', 'tool-abc');

      const result = await storage.getToolUse('session-1', 'tool-abc');
      expect(result).toBeNull();
    });
  });

  describe('project management flow', () => {
    it('should create and retrieve project', async () => {
      const project = {
        id: 'proj-1',
        userId: 12345,
        name: 'Test Project',
        path: '/path/to/project',
        type: 'local' as const,
        createdAt: new Date(),
        lastAccessed: new Date(),
      };

      await storage.saveProject(project);

      const retrieved = await storage.getProject('proj-1', 12345);
      expect(retrieved?.name).toBe('Test Project');
    });

    it('should update session with active project', async () => {
      const session = new UserSessionModel(12345);
      session.setActiveProject('proj-1', '/path/to/project');

      expect(session.activeProject).toBe('proj-1');
      expect(session.projectPath).toBe('/path/to/project');
    });

    it('should list user projects sorted by last accessed', async () => {
      const oldProject = {
        id: 'proj-1',
        userId: 12345,
        name: 'Old Project',
        path: '/old',
        type: 'local' as const,
        createdAt: new Date('2020-01-01'),
        lastAccessed: new Date('2020-01-01'),
      };

      const newProject = {
        id: 'proj-2',
        userId: 12345,
        name: 'New Project',
        path: '/new',
        type: 'local' as const,
        createdAt: new Date('2024-01-01'),
        lastAccessed: new Date('2024-01-01'),
      };

      await storage.saveProject(oldProject);
      await storage.saveProject(newProject);

      const projects = await storage.getUserProjects(12345);

      expect(projects[0].id).toBe('proj-2'); // Most recent first
      expect(projects[1].id).toBe('proj-1');
    });
  });

  describe('error handling', () => {
    it('should handle storage errors gracefully', async () => {
      // Disconnect storage
      await storage.disconnect();

      // Should return null/empty after disconnect
      const session = await storage.getUserSession(12345);
      expect(session).toBeNull();
    });

    it('should handle message batcher callback errors', async () => {
      const errorCallback = vi.fn().mockRejectedValue(new Error('Network error'));
      const errorBatcher = new MessageBatcher(errorCallback);

      // Should not throw
      errorBatcher.addMessage(12345, 'Test message');

      await new Promise(r => setTimeout(r, 100));

      // Callback was attempted
      expect(errorCallback).toHaveBeenCalled();
    });
  });

  describe('concurrent operations', () => {
    it('should handle concurrent session updates', async () => {
      const session = new UserSessionModel(12345);
      await storage.saveUserSession(session);

      // Simulate concurrent updates
      const updates = [
        storage.updateSessionActivity(session),
        storage.updateSessionActivity(session),
        storage.updateSessionActivity(session),
      ];

      await Promise.all(updates);

      const retrieved = await storage.getUserSession(12345);
      expect(retrieved).not.toBeNull();
    });

    it('should handle concurrent message batching', async () => {
      const messages: string[] = [];
      const batcher = new MessageBatcher(async (_chatId, msg) => {
        messages.push(msg);
      });

      // Add messages from "different sources" concurrently
      batcher.addMessage(12345, 'A');
      batcher.addMessage(12345, 'B');
      batcher.addMessage(12345, 'C');

      await new Promise(r => setTimeout(r, 100));

      // All messages should be processed (may be in one or multiple batches)
      expect(messages.length).toBeGreaterThanOrEqual(1);

      // Verify all messages were delivered
      const allMessages = messages.join('\n');
      expect(allMessages).toContain('A');
      expect(allMessages).toContain('B');
      expect(allMessages).toContain('C');
    });
  });
});
