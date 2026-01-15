/**
 * User Analytics Types
 *
 * Types for tracking user activity and generating analytics.
 */

export interface UserActivity {
  chatId: number;
  username?: string;
  firstName?: string;
  lastName?: string;

  // Activity tracking
  firstSeen: Date;
  lastSeen: Date;
  messageCount: number;
  sessionCount: number;

  // Command usage
  commandUsage: Record<string, number>;

  // Daily activity (YYYY-MM-DD -> count)
  dailyActivity: Record<string, number>;
}

export interface UserActivityUpdate {
  chatId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  command?: string;
  timestamp?: Date;
}

export interface AnalyticsSnapshot {
  // Active users
  dau: number;  // Daily Active Users
  wau: number;  // Weekly Active Users
  mau: number;  // Monthly Active Users

  // Total counts
  totalUsers: number;
  totalMessages: number;
  totalSessions: number;

  // Command statistics
  topCommands: Array<{ command: string; count: number }>;

  // User list (for UI)
  recentUsers: UserActivitySummary[];

  // Timestamp
  generatedAt: Date;
}

export interface UserActivitySummary {
  chatId: number;
  username?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  lastSeen: Date;
  messageCount: number;
  sessionCount: number;
  isActive: boolean;  // Active in last 24 hours
}

export interface DailyStats {
  date: string;  // YYYY-MM-DD
  activeUsers: number;
  messages: number;
  sessions: number;
}

export function createEmptyUserActivity(chatId: number): UserActivity {
  return {
    chatId,
    firstSeen: new Date(),
    lastSeen: new Date(),
    messageCount: 0,
    sessionCount: 0,
    commandUsage: {},
    dailyActivity: {},
  };
}

export function getDateKey(date: Date = new Date()): string {
  const result = date.toISOString().split('T')[0];
  return result ?? '';
}

export function isActiveToday(lastSeen: Date): boolean {
  const today = getDateKey();
  const lastSeenDate = getDateKey(lastSeen);
  return today === lastSeenDate;
}

export function isActiveInLastNDays(lastSeen: Date, days: number): boolean {
  const now = new Date();
  const threshold = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return lastSeen >= threshold;
}
