import { createClient, RedisClientType } from 'redis';
import { UserSessionModel } from '../models/user-session';
import { Project } from '../models/project';
import { IStorage } from './interface';
import { logger } from '../utils/logger';
import {
  UserActivity,
  UserActivityUpdate,
  AnalyticsSnapshot,
  UserActivitySummary,
  createEmptyUserActivity,
  getDateKey,
  isActiveInLastNDays,
} from '../models/analytics';
import { ChatMessage, ChatSummary } from '../models/chat-message';

interface BufferedWrite {
  data: string;
  timestamp: number;
  ttl: number;
}

export class RedisStorage implements IStorage {
  private client: RedisClientType;
  private connected: boolean = false;
  private readonly USER_SESSION_PREFIX = 'user_session:';
  private readonly USER_PROJECTS_PREFIX = 'user_projects:';
  private readonly TOOL_USE_PREFIX = 'tool_use:';
  private readonly USER_ACTIVITY_PREFIX = 'user_activity:';
  private readonly USER_ACTIVITY_LIST_KEY = 'user_activity_list';
  private readonly CHAT_MESSAGES_PREFIX = 'chat_messages:';
  private readonly CHAT_SUMMARY_PREFIX = 'chat_summary:';
  private readonly CHAT_LIST_KEY = 'chat_list';
  private readonly SESSION_TTL = 3 * 60 * 60; // 3 hours in seconds
  private readonly TOOL_USE_TTL = 30 * 60; // 30 minutes in seconds
  private readonly PROJECT_TTL = 15 * 24 * 60 * 60; // 15 days in seconds
  private readonly ACTIVITY_TTL = 90 * 24 * 60 * 60; // 90 days in seconds
  private readonly MESSAGE_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
  private readonly MAX_MESSAGES_PER_CHAT = 1000;

  // Write buffer configuration
  private writeBuffer: Map<string, BufferedWrite> = new Map();
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly FLUSH_INTERVAL = 500; // ms
  private readonly MAX_BUFFER_SIZE = 100;
  private flushPromise: Promise<void> | null = null;

  constructor(redisUrl?: string, sessionTimeout: number = 30 * 60 * 1000) {
    this.client = createClient({
      url: redisUrl || process.env.REDIS_URL || 'redis://localhost:6379'
    });

    this.client.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    this.client.on('connect', () => {
      console.log('Connected to Redis');
      this.connected = true;
    });

    this.client.on('disconnect', () => {
      console.log('Disconnected from Redis');
      this.connected = false;
    });
    this.SESSION_TTL = sessionTimeout / 1000; // Convert milliseconds to seconds
  }

  async initialize() {
    this.client.connect();
  }

  async disconnect(): Promise<void> {
    // Flush any pending writes before disconnecting
    await this.flushWrites();

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.connected) {
      await this.client.disconnect();
    }
  }

  /**
   * Schedule a flush of the write buffer
   */
  private scheduleFlush(): void {
    if (this.flushTimer) return;

    this.flushTimer = setTimeout(async () => {
      this.flushTimer = null;
      await this.flushWrites();
    }, this.FLUSH_INTERVAL);
  }

  /**
   * Flush all buffered writes to Redis using pipeline
   */
  private async flushWrites(): Promise<void> {
    // If already flushing, wait for it to complete
    if (this.flushPromise) {
      await this.flushPromise;
      return;
    }

    if (this.writeBuffer.size === 0) return;

    this.flushPromise = this.doFlush();
    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  private async doFlush(): Promise<void> {
    const entries = Array.from(this.writeBuffer.entries());
    this.writeBuffer.clear();

    if (entries.length === 0) return;

    try {
      const pipeline = this.client.multi();

      for (const [key, { data, ttl }] of entries) {
        pipeline.setEx(key, ttl, data);
      }

      await pipeline.exec();
      logger.debug({ count: entries.length }, 'Redis batch write completed');
    } catch (error) {
      logger.error({ err: error, count: entries.length }, 'Redis batch write failed');
      // Re-add failed writes to buffer for retry
      for (const [key, value] of entries) {
        this.writeBuffer.set(key, value);
      }
      throw error;
    }
  }

  /**
   * Buffer a write operation for batch execution
   */
  private bufferWrite(key: string, data: string, ttl: number): void {
    this.writeBuffer.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });

    // Flush immediately if buffer is full
    if (this.writeBuffer.size >= this.MAX_BUFFER_SIZE) {
      this.flushWrites().catch((err) => {
        logger.error({ err }, 'Failed to flush write buffer');
      });
    } else {
      this.scheduleFlush();
    }
  }

  /**
   * Get buffer statistics for monitoring
   */
  getBufferStats(): { size: number; maxSize: number; utilization: number } {
    return {
      size: this.writeBuffer.size,
      maxSize: this.MAX_BUFFER_SIZE,
      utilization: this.writeBuffer.size / this.MAX_BUFFER_SIZE,
    };
  }

  private getUserSessionKey(chatId: number): string {
    return `${this.USER_SESSION_PREFIX}${chatId}`;
  }

  async saveUserSession(userSession: UserSessionModel): Promise<void> {
    const key = this.getUserSessionKey(userSession.chatId);
    const data = JSON.stringify(userSession.toJSON());

    // Use buffered write for better performance
    this.bufferWrite(key, data, this.SESSION_TTL);
  }

  async getUserSession(chatId: number): Promise<UserSessionModel | null> {
    const key = this.getUserSessionKey(chatId);
    const data = await this.client.get(key);
    
    if (!data) {
      return null;
    }

    try {
      const parsed = JSON.parse(data);
      return UserSessionModel.fromJSON(parsed);
    } catch (error) {
      console.error('Error parsing user session data:', error);
      return null;
    }
  }

  async deleteUserSession(chatId: number): Promise<void> {
    const key = this.getUserSessionKey(chatId);
    await this.client.del(key);
  }

  async updateSessionActivity(userSession: UserSessionModel): Promise<void> {
    userSession.updateActivity();
    await this.saveUserSession(userSession);
  }

  // Session-specific methods
  async startClaudeSession(userSession: UserSessionModel, sessionId: string, projectPath?: string): Promise<void> {
    userSession.startSession(sessionId, projectPath);
    await this.saveUserSession(userSession);
  }

  async endClaudeSession(userSession: UserSessionModel): Promise<void> {
    userSession.endSession();
    await this.saveUserSession(userSession);
  }

  // Tool use storage methods for customized handling
  private getToolUseKey(sessionId: string, toolId: string): string {
    return `${this.TOOL_USE_PREFIX}${sessionId}_${toolId}`;
  }

  async storeToolUse(sessionId: string, toolId: string, toolData: {
    name: string;
    messageId: number;
    originalMessage: string;
    chatId: string;
    parentToolUseId?: string;
  }): Promise<void> {
    const key = this.getToolUseKey(sessionId, toolId);
    const data = JSON.stringify({
      ...toolData,
      createdAt: Date.now()
    });

    // Use buffered write for better performance
    this.bufferWrite(key, data, this.TOOL_USE_TTL);
  }

  async getToolUse(sessionId: string, toolId: string): Promise<{
    name: string;
    messageId: number;
    originalMessage: string;
    chatId: string;
    createdAt: number;
    parentToolUseId?: string;
  } | null> {
    const key = this.getToolUseKey(sessionId, toolId);
    const data = await this.client.get(key);
    
    if (!data) {
      return null;
    }

    try {
      return JSON.parse(data);
    } catch (error) {
      console.error('Error parsing tool use data:', error);
      return null;
    }
  }

  async deleteToolUse(sessionId: string, toolId: string): Promise<void> {
    const key = this.getToolUseKey(sessionId, toolId);
    await this.client.del(key);
  }

  // Project management methods
  private getUserProjectsKey(userId: number): string {
    return `${this.USER_PROJECTS_PREFIX}${userId}`;
  }

  async getUserProjects(userId: number): Promise<Project[]> {
    const key = this.getUserProjectsKey(userId);
    const hashData = await this.client.hGetAll(key);
    const projects: Project[] = [];
    
    for (const value of Object.values(hashData)) {
      try {
        const project = JSON.parse(value);
        // Convert date strings back to Date objects
        project.createdAt = new Date(project.createdAt);
        project.lastAccessed = new Date(project.lastAccessed);
        projects.push(project);
      } catch (error) {
        console.error('Error parsing project data:', error);
      }
    }
    
    return projects.sort((a, b) => b.lastAccessed.getTime() - a.lastAccessed.getTime());
  }

  async getProject(projectId: string, userId: number): Promise<Project | null> {
    const key = this.getUserProjectsKey(userId);
    const projectJson = await this.client.hGet(key, projectId);
    
    if (!projectJson) {
      return null;
    }

    try {
      const project = JSON.parse(projectJson);
      // Convert date strings back to Date objects
      project.createdAt = new Date(project.createdAt);
      project.lastAccessed = new Date(project.lastAccessed);
      return project;
    } catch (error) {
      console.error('Error parsing project data:', error);
      return null;
    }
  }

  async saveProject(project: Project): Promise<void> {
    const key = this.getUserProjectsKey(project.userId);
    const projectData = {
      ...project,
      createdAt: project.createdAt.toISOString(),
      lastAccessed: project.lastAccessed.toISOString()
    };
    
    await this.client.hSet(key, project.id, JSON.stringify(projectData));
    await this.client.expire(key, this.PROJECT_TTL);
  }

  async deleteProject(projectId: string, userId: number): Promise<void> {
    const key = this.getUserProjectsKey(userId);
    await this.client.hDel(key, projectId);
  }

  async updateProjectLastAccessed(projectId: string, userId: number): Promise<void> {
    const project = await this.getProject(projectId, userId);
    if (project) {
      project.lastAccessed = new Date();
      await this.saveProject(project);
    }
  }

  // User analytics methods (Phase 2)
  private getUserActivityKey(chatId: number): string {
    return `${this.USER_ACTIVITY_PREFIX}${chatId}`;
  }

  async trackUserActivity(update: UserActivityUpdate): Promise<void> {
    const { chatId, username, firstName, lastName, command, timestamp } = update;
    const now = timestamp || new Date();
    const dateKey = getDateKey(now);
    const key = this.getUserActivityKey(chatId);

    // Get existing activity or create new
    let activity = await this.getUserActivity(chatId);
    if (!activity) {
      activity = createEmptyUserActivity(chatId);
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

    // Save to Redis
    const activityData = {
      ...activity,
      firstSeen: activity.firstSeen.toISOString(),
      lastSeen: activity.lastSeen.toISOString(),
    };
    await this.client.set(key, JSON.stringify(activityData), { EX: this.ACTIVITY_TTL });

    // Add to user list for enumeration
    await this.client.sAdd(this.USER_ACTIVITY_LIST_KEY, chatId.toString());
  }

  async getUserActivity(chatId: number): Promise<UserActivity | null> {
    const key = this.getUserActivityKey(chatId);
    const data = await this.client.get(key);

    if (!data) {
      return null;
    }

    try {
      const parsed = JSON.parse(data);
      return {
        ...parsed,
        firstSeen: new Date(parsed.firstSeen),
        lastSeen: new Date(parsed.lastSeen),
      };
    } catch (error) {
      console.error('Error parsing user activity:', error);
      return null;
    }
  }

  async getAllUserActivities(): Promise<UserActivity[]> {
    const chatIds = await this.client.sMembers(this.USER_ACTIVITY_LIST_KEY);
    const activities: UserActivity[] = [];

    for (const chatIdStr of chatIds) {
      const chatId = parseInt(chatIdStr, 10);
      const activity = await this.getUserActivity(chatId);
      if (activity) {
        activities.push(activity);
      }
    }

    return activities.sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
  }

  async getAnalyticsSnapshot(): Promise<AnalyticsSnapshot> {
    const activities = await this.getAllUserActivities();
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

  // Chat message storage methods (Message Simulator)
  private getChatMessagesKey(chatId: number): string {
    return `${this.CHAT_MESSAGES_PREFIX}${chatId}`;
  }

  private getChatSummaryKey(chatId: number): string {
    return `${this.CHAT_SUMMARY_PREFIX}${chatId}`;
  }

  async saveChatMessage(message: ChatMessage): Promise<void> {
    const chatId = message.chatId;
    const messagesKey = this.getChatMessagesKey(chatId);
    const summaryKey = this.getChatSummaryKey(chatId);

    // Add message to sorted set with timestamp as score
    await this.client.zAdd(messagesKey, {
      score: message.timestamp,
      value: JSON.stringify(message),
    });

    // Trim to keep only the most recent messages (ring buffer behavior)
    const count = await this.client.zCard(messagesKey);
    if (count > this.MAX_MESSAGES_PER_CHAT) {
      await this.client.zRemRangeByRank(messagesKey, 0, count - this.MAX_MESSAGES_PER_CHAT - 1);
    }

    // Set TTL on messages
    await this.client.expire(messagesKey, this.MESSAGE_TTL);

    // Update chat summary
    const existingSummaryJson = await this.client.get(summaryKey);
    const existingSummary: Partial<ChatSummary> = existingSummaryJson
      ? JSON.parse(existingSummaryJson)
      : {};

    const summary: ChatSummary = {
      chatId,
      username: message.metadata?.username || existingSummary.username,
      firstName: message.metadata?.firstName || existingSummary.firstName,
      lastName: message.metadata?.lastName || existingSummary.lastName,
      lastMessage: message.content.substring(0, 100),
      lastMessageTime: message.timestamp,
      unreadCount: message.direction === 'incoming'
        ? (existingSummary.unreadCount || 0) + 1
        : 0,
    };

    await this.client.set(summaryKey, JSON.stringify(summary), { EX: this.MESSAGE_TTL });

    // Add to chat list for enumeration
    await this.client.sAdd(this.CHAT_LIST_KEY, chatId.toString());
  }

  async getChatMessages(chatId: number, limit: number = 50, before?: number): Promise<ChatMessage[]> {
    const messagesKey = this.getChatMessagesKey(chatId);

    let messageJsons: string[];
    if (before) {
      // Get messages before a specific timestamp
      messageJsons = await this.client.zRangeByScore(
        messagesKey,
        '-inf',
        before - 1,
        { LIMIT: { offset: 0, count: limit } }
      );
    } else {
      // Get most recent messages
      messageJsons = await this.client.zRange(
        messagesKey,
        -limit,
        -1
      );
    }

    return messageJsons.map(json => JSON.parse(json) as ChatMessage);
  }

  async getRecentChats(limit: number = 50): Promise<ChatSummary[]> {
    const chatIds = await this.client.sMembers(this.CHAT_LIST_KEY);
    const summaries: ChatSummary[] = [];

    for (const chatIdStr of chatIds) {
      const chatId = parseInt(chatIdStr, 10);
      const summaryKey = this.getChatSummaryKey(chatId);
      const summaryJson = await this.client.get(summaryKey);

      if (summaryJson) {
        summaries.push(JSON.parse(summaryJson) as ChatSummary);
      }
    }

    // Sort by last message time, most recent first
    return summaries
      .sort((a, b) => b.lastMessageTime - a.lastMessageTime)
      .slice(0, limit);
  }
}