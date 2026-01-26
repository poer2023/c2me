import { UserState, PermissionMode, FileBrowsingState, HandoffOwner } from './types';

export interface UserSession {
  chatId: number;
  
  // User state management
  state: UserState;
  currentInput: string;
  lastActivity: Date;
  
  // Project management
  activeProject: string;
  
  // Claude session management
  sessionId?: string;
  projectPath: string;
  active: boolean;

  // Terminal handoff management
  handoffOwner?: HandoffOwner;
  handoffExpiresAt?: number;
  
  // Permission management
  permissionMode: PermissionMode;
  
  // File browsing state
  fileBrowsingState?: FileBrowsingState;
  
  // Security authentication
  authenticated: boolean;
}

export class UserSessionModel {
  chatId: number;
  state: UserState;
  lastActivity: Date;
  activeProject: string;
  sessionId?: string;
  projectPath: string;
  active: boolean;
  permissionMode: PermissionMode;
  fileBrowsingState?: FileBrowsingState;
  authenticated: boolean;
  handoffOwner?: HandoffOwner;
  handoffExpiresAt?: number;

  constructor(chatId: number) {
    this.chatId = chatId;
    this.state = UserState.Idle;
    this.lastActivity = new Date();
    this.activeProject = '';
    this.projectPath = '';
    this.active = false;
    this.permissionMode = PermissionMode.Default;
    this.authenticated = false;
    this.handoffOwner = undefined;
    this.handoffExpiresAt = undefined;
  }

  setActive(active: boolean): void {
    this.active = active;
    this.updateActivity();
  }

  // User state methods
  setState(state: UserState): void {
    this.state = state;
    this.updateActivity();
  }

  updateActivity(): void {
    this.lastActivity = new Date();
  }

  // Project management methods
  setActiveProject(projectId: string, projectPath: string): void {
    this.activeProject = projectId;
    this.projectPath = projectPath;
    this.updateActivity();
  }

  clearActiveProject(): void {
    this.activeProject = '';
    this.projectPath = '';
    this.updateActivity();
  }

  // Claude session methods
  startSession(sessionId: string, projectPath?: string): void {
    this.sessionId = sessionId;
    this.active = true;
    if (projectPath) {
      this.projectPath = projectPath;
    }
    this.updateActivity();
  }

  endSession(): void {
    delete this.sessionId;
    this.active = false;
    this.setState(UserState.Idle);
    this.updateActivity();
  }

  isSessionActive(): boolean {
    return this.active && !!this.sessionId;
  }

  setHandoffOwner(owner: HandoffOwner, ttlMs: number): void {
    this.handoffOwner = owner;
    this.handoffExpiresAt = Date.now() + ttlMs;
    this.updateActivity();
  }

  clearHandoff(): void {
    delete this.handoffOwner;
    delete this.handoffExpiresAt;
    this.updateActivity();
  }

  clearExpiredHandoff(now: number = Date.now()): boolean {
    if (!this.handoffExpiresAt) {
      return false;
    }
    if (this.handoffExpiresAt > now) {
      return false;
    }
    delete this.handoffOwner;
    delete this.handoffExpiresAt;
    return true;
  }

  isHandoffActive(now: number = Date.now()): boolean {
    if (!this.handoffOwner || !this.handoffExpiresAt) {
      return false;
    }
    return this.handoffExpiresAt > now;
  }

  getHandoffOwner(now: number = Date.now()): HandoffOwner | null {
    if (!this.isHandoffActive(now)) {
      return null;
    }
    return this.handoffOwner || null;
  }

  getHandoffExpiresAt(now: number = Date.now()): number | null {
    if (!this.isHandoffActive(now)) {
      return null;
    }
    return this.handoffExpiresAt || null;
  }

  // Permission mode methods
  setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = mode;
    this.updateActivity();
  }

  getPermissionMode(): PermissionMode {
    return this.permissionMode;
  }

  // Authentication methods
  setAuthenticated(authenticated: boolean): void {
    this.authenticated = authenticated;
    this.updateActivity();
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  // File browsing methods
  setFileBrowsingState(state: FileBrowsingState): void {
    this.fileBrowsingState = state;
    this.updateActivity();
  }

  getFileBrowsingState(): FileBrowsingState | undefined {
    return this.fileBrowsingState;
  }

  clearFileBrowsingState(): void {
    delete this.fileBrowsingState;
    this.updateActivity();
  }

  // Serialization methods
  toJSON(): Record<string, unknown> {
    return {
      chatId: this.chatId,
      state: this.state,
      lastActivity: this.lastActivity.toISOString(),
      activeProject: this.activeProject,
      sessionId: this.sessionId,
      projectPath: this.projectPath,
      active: this.active,
      permissionMode: this.permissionMode,
      fileBrowsingState: this.fileBrowsingState,
      authenticated: this.authenticated,
      handoffOwner: this.handoffOwner,
      handoffExpiresAt: this.handoffExpiresAt
    };
  }

  static fromJSON(data: Record<string, unknown>): UserSessionModel {
    const userSession = new UserSessionModel(data.chatId as number);
    userSession.state = data.state as UserState;
    userSession.lastActivity = new Date(data.lastActivity as string | number);
    
    userSession.activeProject = (data.activeProject as string) || '';
    if (data.sessionId) {
      userSession.sessionId = data.sessionId as string;
    }
    userSession.projectPath = (data.projectPath as string) || '';
    userSession.active = (data.active as boolean) || false;
    userSession.permissionMode = (data.permissionMode as PermissionMode) || PermissionMode.Default;
    if (data.fileBrowsingState) {
      userSession.fileBrowsingState = data.fileBrowsingState as FileBrowsingState;
    }
    userSession.authenticated = (data.authenticated as boolean) || false;
    if (data.handoffOwner) {
      userSession.handoffOwner = data.handoffOwner as HandoffOwner;
    }
    if (data.handoffExpiresAt) {
      userSession.handoffExpiresAt = data.handoffExpiresAt as number;
    }
    
    return userSession;
  }
}
