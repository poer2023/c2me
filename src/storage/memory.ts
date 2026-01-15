import { UserSessionModel } from '../models/user-session';
import { Project } from '../models/project';
import { IStorage } from './interface';
import {
  UserActivity,
  UserActivityUpdate,
  AnalyticsSnapshot,
  UserActivitySummary,
  createEmptyUserActivity,
  getDateKey,
  isActiveInLastNDays,
} from '../models/analytics';

export class MemoryStorage implements IStorage {
  private userSessions: Map<number, UserSessionModel> = new Map();
  private userProjects: Map<number, Map<string, Project>> = new Map();
  private toolUseStorage: Map<string, {
    name: string;
    messageId: number;
    originalMessage: string;
    chatId: string;
    createdAt: number;
  }> = new Map();

  // User analytics storage
  private userActivities: Map<number, UserActivity> = new Map();

  async initialize(): Promise<void> {
    console.log('Memory storage initialized');
  }

  async disconnect(): Promise<void> {
    this.userSessions.clear();
    this.userProjects.clear();
    this.toolUseStorage.clear();
    console.log('Memory storage disconnected');
  }

  async saveUserSession(userSession: UserSessionModel): Promise<void> {
    this.userSessions.set(userSession.chatId, userSession);
  }

  async getUserSession(chatId: number): Promise<UserSessionModel | null> {
    return this.userSessions.get(chatId) || null;
  }

  async deleteUserSession(chatId: number): Promise<void> {
    this.userSessions.delete(chatId);
  }
  
  async updateSessionActivity(userSession: UserSessionModel): Promise<void> {
    userSession.updateActivity();
    await this.saveUserSession(userSession);
  }

  async startClaudeSession(userSession: UserSessionModel, sessionId: string, projectPath?: string): Promise<void> {
    userSession.startSession(sessionId, projectPath);
    await this.saveUserSession(userSession);
  }

  async endClaudeSession(userSession: UserSessionModel): Promise<void> {
    userSession.endSession();
    await this.saveUserSession(userSession);
  }


  private getToolUseKey(sessionId: string, toolId: string): string {
    return `tool_use_storage:${sessionId}_${toolId}`;
  }

  async storeToolUse(sessionId: string, toolId: string, toolData: {
    name: string;
    messageId: number;
    originalMessage: string;
    chatId: string;
  }): Promise<void> {
    const key = this.getToolUseKey(sessionId, toolId);
    const data = {
      ...toolData,
      createdAt: Date.now()
    };
    this.toolUseStorage.set(key, data);

    // Auto-cleanup after 30 minutes
    setTimeout(() => {
      this.toolUseStorage.delete(key);
    }, 30 * 60 * 1000);
  }

  async getToolUse(sessionId: string, toolId: string): Promise<{
    name: string;
    messageId: number;
    originalMessage: string;
    chatId: string;
    createdAt: number;
  } | null> {
    const key = this.getToolUseKey(sessionId, toolId);
    return this.toolUseStorage.get(key) || null;
  }

  async deleteToolUse(sessionId: string, toolId: string): Promise<void> {
    const key = this.getToolUseKey(sessionId, toolId);
    this.toolUseStorage.delete(key);
  }

  // Project management methods
  async getUserProjects(userId: number): Promise<Project[]> {
    const projectsMap = this.userProjects.get(userId);
    if (!projectsMap) {
      return [];
    }
    
    return Array.from(projectsMap.values())
      .sort((a, b) => b.lastAccessed.getTime() - a.lastAccessed.getTime());
  }

  async getProject(projectId: string, userId: number): Promise<Project | null> {
    const projectsMap = this.userProjects.get(userId);
    if (!projectsMap) {
      return null;
    }
    
    return projectsMap.get(projectId) || null;
  }

  async saveProject(project: Project): Promise<void> {
    if (!this.userProjects.has(project.userId)) {
      this.userProjects.set(project.userId, new Map());
    }
    
    this.userProjects.get(project.userId)!.set(project.id, { ...project });
  }

  async deleteProject(projectId: string, userId: number): Promise<void> {
    const projectsMap = this.userProjects.get(userId);
    if (projectsMap) {
      projectsMap.delete(projectId);
    }
  }

  async updateProjectLastAccessed(projectId: string, userId: number): Promise<void> {
    const project = await this.getProject(projectId, userId);
    if (project) {
      project.lastAccessed = new Date();
      await this.saveProject(project);
    }
  }

  // User analytics methods (Phase 2)
  async trackUserActivity(update: UserActivityUpdate): Promise<void> {
    const { chatId, username, firstName, lastName, command, timestamp } = update;
    const now = timestamp || new Date();
    const dateKey = getDateKey(now);

    let activity = this.userActivities.get(chatId);
    if (!activity) {
      activity = createEmptyUserActivity(chatId);
      this.userActivities.set(chatId, activity);
    }

    // Update user info
    if (username) activity.username = username;
    if (firstName) activity.firstName = firstName;
    if (lastName) activity.lastName = lastName;

    // Update activity
    activity.lastSeen = now;
    activity.messageCount++;

    // Update daily activity
    activity.dailyActivity[dateKey] = (activity.dailyActivity[dateKey] || 0) + 1;

    // Update command usage
    if (command) {
      activity.commandUsage[command] = (activity.commandUsage[command] || 0) + 1;
    }
  }

  async getUserActivity(chatId: number): Promise<UserActivity | null> {
    return this.userActivities.get(chatId) || null;
  }

  async getAllUserActivities(): Promise<UserActivity[]> {
    return Array.from(this.userActivities.values())
      .sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
  }

  async getAnalyticsSnapshot(): Promise<AnalyticsSnapshot> {
    const activities = Array.from(this.userActivities.values());
    const now = new Date();

    // Calculate DAU/WAU/MAU
    const dau = activities.filter(a => isActiveInLastNDays(a.lastSeen, 1)).length;
    const wau = activities.filter(a => isActiveInLastNDays(a.lastSeen, 7)).length;
    const mau = activities.filter(a => isActiveInLastNDays(a.lastSeen, 30)).length;

    // Calculate totals
    const totalUsers = activities.length;
    const totalMessages = activities.reduce((sum, a) => sum + a.messageCount, 0);
    const totalSessions = activities.reduce((sum, a) => sum + a.sessionCount, 0);

    // Calculate top commands
    const commandCounts: Record<string, number> = {};
    for (const activity of activities) {
      for (const [cmd, count] of Object.entries(activity.commandUsage)) {
        commandCounts[cmd] = (commandCounts[cmd] || 0) + count;
      }
    }
    const topCommands = Object.entries(commandCounts)
      .map(([command, count]) => ({ command, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Get recent users
    const recentUsers: UserActivitySummary[] = activities
      .slice(0, 50)
      .map(a => ({
        chatId: a.chatId,
        username: a.username,
        firstName: a.firstName,
        lastName: a.lastName,
        lastSeen: a.lastSeen,
        messageCount: a.messageCount,
        sessionCount: a.sessionCount,
        isActive: isActiveInLastNDays(a.lastSeen, 1),
      }));

    return {
      dau,
      wau,
      mau,
      totalUsers,
      totalMessages,
      totalSessions,
      topCommands,
      recentUsers,
      generatedAt: now,
    };
  }
}