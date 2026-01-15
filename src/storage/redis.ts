import { createClient, RedisClientType } from 'redis';
import { UserSessionModel } from '../models/user-session';
import { Project } from '../models/project';
import { IStorage } from './interface';
import { logger } from '../utils/logger';

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
  private readonly SESSION_TTL = 3 * 60 * 60; // 3 hours in seconds
  private readonly TOOL_USE_TTL = 30 * 60; // 30 minutes in seconds
  private readonly PROJECT_TTL = 15 * 24 * 60 * 60; // 15 days in seconds

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
}