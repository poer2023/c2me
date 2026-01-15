import { describe, it, expect, beforeEach } from 'vitest';
import { UserSessionModel } from '../../../src/models/user-session';
import { UserState, PermissionMode } from '../../../src/models/types';

describe('UserSessionModel', () => {
  let session: UserSessionModel;

  beforeEach(() => {
    session = new UserSessionModel(12345);
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      expect(session.chatId).toBe(12345);
      expect(session.state).toBe(UserState.Idle);
      expect(session.activeProject).toBe('');
      expect(session.projectPath).toBe('');
      expect(session.active).toBe(false);
      expect(session.permissionMode).toBe(PermissionMode.Default);
      expect(session.authenticated).toBe(false);
    });
  });

  describe('state management', () => {
    it('should set state correctly', () => {
      session.setState(UserState.InSession);
      expect(session.state).toBe(UserState.InSession);
    });

    it('should update activity when setting state', () => {
      const originalActivity = session.lastActivity;

      setTimeout(() => {
        session.setState(UserState.InSession);
        expect(session.lastActivity.getTime()).toBeGreaterThanOrEqual(originalActivity.getTime());
      }, 1);
    });
  });

  describe('active state', () => {
    it('should set active state', () => {
      session.setActive(true);
      expect(session.active).toBe(true);

      session.setActive(false);
      expect(session.active).toBe(false);
    });
  });

  describe('project management', () => {
    it('should set active project', () => {
      session.setActiveProject('proj-123', '/path/to/project');

      expect(session.activeProject).toBe('proj-123');
      expect(session.projectPath).toBe('/path/to/project');
    });

    it('should clear active project', () => {
      session.setActiveProject('proj-123', '/path');
      session.clearActiveProject();

      expect(session.activeProject).toBe('');
      expect(session.projectPath).toBe('');
    });
  });

  describe('claude session management', () => {
    it('should start session', () => {
      session.startSession('session-abc', '/project/path');

      expect(session.sessionId).toBe('session-abc');
      expect(session.active).toBe(true);
      expect(session.projectPath).toBe('/project/path');
    });

    it('should start session without project path', () => {
      session.projectPath = '/existing/path';
      session.startSession('session-abc');

      expect(session.sessionId).toBe('session-abc');
      expect(session.projectPath).toBe('/existing/path');
    });

    it('should end session', () => {
      session.startSession('session-abc');
      session.endSession();

      expect(session.sessionId).toBeUndefined();
      expect(session.active).toBe(false);
      expect(session.state).toBe(UserState.Idle);
    });

    it('should check if session is active', () => {
      expect(session.isSessionActive()).toBe(false);

      session.startSession('session-abc');
      expect(session.isSessionActive()).toBe(true);

      session.endSession();
      expect(session.isSessionActive()).toBe(false);
    });
  });

  describe('permission mode', () => {
    it('should set permission mode', () => {
      session.setPermissionMode(PermissionMode.AcceptEdits);
      expect(session.getPermissionMode()).toBe(PermissionMode.AcceptEdits);
    });

    it('should default to Default mode', () => {
      expect(session.getPermissionMode()).toBe(PermissionMode.Default);
    });
  });

  describe('authentication', () => {
    it('should set authenticated state', () => {
      session.setAuthenticated(true);
      expect(session.isAuthenticated()).toBe(true);

      session.setAuthenticated(false);
      expect(session.isAuthenticated()).toBe(false);
    });
  });

  describe('file browsing state', () => {
    it('should set file browsing state', () => {
      const browsingState = {
        currentPath: '/some/path',
        page: 1,
        messageId: 100,
      };

      session.setFileBrowsingState(browsingState);
      expect(session.getFileBrowsingState()).toEqual(browsingState);
    });

    it('should clear file browsing state', () => {
      session.setFileBrowsingState({ currentPath: '/path', page: 0, messageId: 1 });
      session.clearFileBrowsingState();

      expect(session.getFileBrowsingState()).toBeUndefined();
    });
  });

  describe('serialization', () => {
    it('should serialize to JSON', () => {
      session.setState(UserState.InSession);
      session.startSession('session-123', '/project');
      session.setPermissionMode(PermissionMode.AcceptEdits);
      session.setAuthenticated(true);

      const json = session.toJSON();

      expect(json.chatId).toBe(12345);
      expect(json.state).toBe(UserState.InSession);
      expect(json.sessionId).toBe('session-123');
      expect(json.projectPath).toBe('/project');
      expect(json.active).toBe(true);
      expect(json.permissionMode).toBe(PermissionMode.AcceptEdits);
      expect(json.authenticated).toBe(true);
      expect(json.lastActivity).toBeDefined();
    });

    it('should deserialize from JSON', () => {
      const json = {
        chatId: 67890,
        state: UserState.InSession,
        lastActivity: new Date().toISOString(),
        activeProject: 'proj-1',
        sessionId: 'session-456',
        projectPath: '/another/path',
        active: true,
        permissionMode: PermissionMode.BypassPermissions,
        authenticated: true,
        fileBrowsingState: { currentPath: '/path', page: 2, messageId: 50 },
      };

      const restored = UserSessionModel.fromJSON(json);

      expect(restored.chatId).toBe(67890);
      expect(restored.state).toBe(UserState.InSession);
      expect(restored.activeProject).toBe('proj-1');
      expect(restored.sessionId).toBe('session-456');
      expect(restored.projectPath).toBe('/another/path');
      expect(restored.active).toBe(true);
      expect(restored.permissionMode).toBe(PermissionMode.BypassPermissions);
      expect(restored.authenticated).toBe(true);
      expect(restored.fileBrowsingState).toEqual(json.fileBrowsingState);
    });

    it('should handle missing optional fields in JSON', () => {
      const json = {
        chatId: 11111,
        state: UserState.Idle,
        lastActivity: new Date().toISOString(),
      };

      const restored = UserSessionModel.fromJSON(json);

      expect(restored.chatId).toBe(11111);
      expect(restored.activeProject).toBe('');
      expect(restored.sessionId).toBeUndefined();
      expect(restored.projectPath).toBe('');
      expect(restored.active).toBe(false);
      expect(restored.permissionMode).toBe(PermissionMode.Default);
      expect(restored.authenticated).toBe(false);
    });
  });
});
