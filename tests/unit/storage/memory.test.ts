import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStorage } from '../../../src/storage/memory';
import { UserSessionModel } from '../../../src/models/user-session';
import { UserState, PermissionMode } from '../../../src/models/types';

describe('MemoryStorage', () => {
  let storage: MemoryStorage;

  beforeEach(async () => {
    storage = new MemoryStorage();
    await storage.initialize();
  });

  describe('user session operations', () => {
    it('should save and retrieve user session', async () => {
      const session = new UserSessionModel(12345);
      session.setState(UserState.InSession);

      await storage.saveUserSession(session);
      const retrieved = await storage.getUserSession(12345);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.chatId).toBe(12345);
      expect(retrieved?.state).toBe(UserState.InSession);
    });

    it('should return null for non-existent session', async () => {
      const result = await storage.getUserSession(99999);
      expect(result).toBeNull();
    });

    it('should delete user session', async () => {
      const session = new UserSessionModel(12345);
      await storage.saveUserSession(session);

      await storage.deleteUserSession(12345);
      const result = await storage.getUserSession(12345);

      expect(result).toBeNull();
    });

    it('should update session activity', async () => {
      const session = new UserSessionModel(12345);
      const originalActivity = session.lastActivity;

      await new Promise(r => setTimeout(r, 10));
      await storage.updateSessionActivity(session);

      expect(session.lastActivity.getTime()).toBeGreaterThan(originalActivity.getTime());
    });

    it('should start claude session', async () => {
      const session = new UserSessionModel(12345);
      await storage.saveUserSession(session);

      await storage.startClaudeSession(session, 'session-123', '/project/path');

      expect(session.sessionId).toBe('session-123');
      expect(session.projectPath).toBe('/project/path');
      expect(session.active).toBe(true);
    });

    it('should end claude session', async () => {
      const session = new UserSessionModel(12345);
      session.startSession('session-123');
      await storage.saveUserSession(session);

      await storage.endClaudeSession(session);

      expect(session.sessionId).toBeUndefined();
      expect(session.active).toBe(false);
      expect(session.state).toBe(UserState.Idle);
    });
  });

  describe('tool use storage', () => {
    it('should store and retrieve tool use data', async () => {
      const toolData = {
        name: 'Edit',
        messageId: 100,
        originalMessage: 'Test message',
        chatId: '12345',
      };

      await storage.storeToolUse('session-1', 'tool-1', toolData);
      const retrieved = await storage.getToolUse('session-1', 'tool-1');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('Edit');
      expect(retrieved?.messageId).toBe(100);
      expect(retrieved?.createdAt).toBeDefined();
    });

    it('should return null for non-existent tool use', async () => {
      const result = await storage.getToolUse('session-x', 'tool-x');
      expect(result).toBeNull();
    });

    it('should delete tool use data', async () => {
      const toolData = {
        name: 'Read',
        messageId: 101,
        originalMessage: 'Test',
        chatId: '12345',
      };

      await storage.storeToolUse('session-1', 'tool-1', toolData);
      await storage.deleteToolUse('session-1', 'tool-1');

      const result = await storage.getToolUse('session-1', 'tool-1');
      expect(result).toBeNull();
    });
  });

  describe('project management', () => {
    const testProject = {
      id: 'proj-1',
      userId: 12345,
      name: 'Test Project',
      path: '/path/to/project',
      type: 'local' as const,
      createdAt: new Date(),
      lastAccessed: new Date(),
    };

    it('should save and retrieve project', async () => {
      await storage.saveProject(testProject);
      const retrieved = await storage.getProject('proj-1', 12345);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('Test Project');
    });

    it('should return null for non-existent project', async () => {
      const result = await storage.getProject('non-existent', 12345);
      expect(result).toBeNull();
    });

    it('should get all user projects', async () => {
      const project1 = { ...testProject, id: 'proj-1', name: 'Project 1' };
      const project2 = { ...testProject, id: 'proj-2', name: 'Project 2' };

      await storage.saveProject(project1);
      await storage.saveProject(project2);

      const projects = await storage.getUserProjects(12345);

      expect(projects).toHaveLength(2);
    });

    it('should return empty array for user with no projects', async () => {
      const projects = await storage.getUserProjects(99999);
      expect(projects).toEqual([]);
    });

    it('should delete project', async () => {
      await storage.saveProject(testProject);
      await storage.deleteProject('proj-1', 12345);

      const result = await storage.getProject('proj-1', 12345);
      expect(result).toBeNull();
    });

    it('should update project last accessed', async () => {
      const oldDate = new Date('2020-01-01');
      const project = { ...testProject, lastAccessed: oldDate };

      await storage.saveProject(project);
      await storage.updateProjectLastAccessed('proj-1', 12345);

      const retrieved = await storage.getProject('proj-1', 12345);
      expect(retrieved?.lastAccessed.getTime()).toBeGreaterThan(oldDate.getTime());
    });

    it('should sort projects by last accessed', async () => {
      const project1 = {
        ...testProject,
        id: 'proj-1',
        lastAccessed: new Date('2020-01-01'),
      };
      const project2 = {
        ...testProject,
        id: 'proj-2',
        lastAccessed: new Date('2023-01-01'),
      };

      await storage.saveProject(project1);
      await storage.saveProject(project2);

      const projects = await storage.getUserProjects(12345);

      expect(projects[0].id).toBe('proj-2'); // Most recent first
    });
  });

  describe('disconnect', () => {
    it('should clear all data on disconnect', async () => {
      const session = new UserSessionModel(12345);
      await storage.saveUserSession(session);

      await storage.disconnect();

      const result = await storage.getUserSession(12345);
      expect(result).toBeNull();
    });
  });
});
