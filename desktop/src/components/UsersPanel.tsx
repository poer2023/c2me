import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface UserActivitySummary {
  chatId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  lastSeen: string;
  messageCount: number;
  sessionCount: number;
  isActive: boolean;
}

interface CommandStat {
  command: string;
  count: number;
}

interface AnalyticsSnapshot {
  dau: number;
  wau: number;
  mau: number;
  totalUsers: number;
  totalMessages: number;
  totalSessions: number;
  topCommands: CommandStat[];
  recentUsers: UserActivitySummary[];
  generatedAt: string;
}

interface UsersPanelProps {
  isRunning: boolean;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatUserName(user: UserActivitySummary): string {
  if (user.username) return `@${user.username}`;
  if (user.firstName) {
    return user.lastName ? `${user.firstName} ${user.lastName}` : user.firstName;
  }
  return `User ${user.chatId}`;
}

export function UsersPanel({ isRunning }: UsersPanelProps) {
  const [analytics, setAnalytics] = useState<AnalyticsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchAnalytics = async () => {
    if (!isRunning) {
      setAnalytics(null);
      setError('Bot is not running');
      return;
    }

    setLoading(true);
    try {
      const data = await invoke<AnalyticsSnapshot>('fetch_analytics');
      setAnalytics(data);
      setError(null);
    } catch (err) {
      setError(`${err}`);
      setAnalytics(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, [isRunning]);

  // Filter users based on search query
  const filteredUsers = analytics?.recentUsers.filter(user => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      user.username?.toLowerCase().includes(query) ||
      user.firstName?.toLowerCase().includes(query) ||
      user.lastName?.toLowerCase().includes(query) ||
      user.chatId.toString().includes(query)
    );
  }) || [];

  if (!isRunning) {
    return (
      <div className="users-panel">
        <div className="users-empty">
          <span className="users-empty-icon">👥</span>
          <p>Start the bot to view user analytics</p>
        </div>
      </div>
    );
  }

  if (loading && !analytics) {
    return (
      <div className="users-panel">
        <div className="users-loading">Loading analytics...</div>
      </div>
    );
  }

  if (error && !analytics) {
    return (
      <div className="users-panel">
        <div className="users-error">
          <span className="users-error-icon">⚠️</span>
          <p>{error}</p>
          <button className="btn btn-secondary btn-small" onClick={fetchAnalytics}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!analytics) return null;

  return (
    <div className="users-panel">
      {/* DAU/WAU/MAU Stats */}
      <div className="users-section">
        <h3 className="users-section-title">Active Users</h3>
        <div className="users-stats-grid">
          <div className="user-stat-card highlight">
            <div className="user-stat-value">{analytics.dau}</div>
            <div className="user-stat-label">DAU</div>
            <div className="user-stat-hint">Daily Active</div>
          </div>
          <div className="user-stat-card">
            <div className="user-stat-value">{analytics.wau}</div>
            <div className="user-stat-label">WAU</div>
            <div className="user-stat-hint">Weekly Active</div>
          </div>
          <div className="user-stat-card">
            <div className="user-stat-value">{analytics.mau}</div>
            <div className="user-stat-label">MAU</div>
            <div className="user-stat-hint">Monthly Active</div>
          </div>
        </div>
      </div>

      {/* Total Stats */}
      <div className="users-section">
        <h3 className="users-section-title">Total Statistics</h3>
        <div className="users-stats-grid">
          <div className="user-stat-card">
            <div className="user-stat-value">{analytics.totalUsers}</div>
            <div className="user-stat-label">Total Users</div>
          </div>
          <div className="user-stat-card">
            <div className="user-stat-value">{analytics.totalMessages}</div>
            <div className="user-stat-label">Total Messages</div>
          </div>
          <div className="user-stat-card">
            <div className="user-stat-value">{analytics.totalSessions}</div>
            <div className="user-stat-label">Total Sessions</div>
          </div>
        </div>
      </div>

      {/* Top Commands */}
      {analytics.topCommands.length > 0 && (
        <div className="users-section">
          <h3 className="users-section-title">Top Commands</h3>
          <div className="commands-list">
            {analytics.topCommands.slice(0, 5).map((cmd, index) => (
              <div key={cmd.command} className="command-item">
                <span className="command-rank">#{index + 1}</span>
                <span className="command-name">/{cmd.command}</span>
                <span className="command-count">{cmd.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Users */}
      <div className="users-section">
        <h3 className="users-section-title">Recent Users ({analytics.recentUsers.length})</h3>
        <div className="users-search">
          <input
            type="text"
            className="users-search-input"
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="users-list">
          {filteredUsers.length === 0 ? (
            <div className="users-list-empty">
              {analytics.recentUsers.length === 0
                ? 'No users yet'
                : 'No users match your search'}
            </div>
          ) : (
            filteredUsers.map((user) => (
              <div key={user.chatId} className={`user-item ${user.isActive ? 'active' : ''}`}>
                <div className="user-avatar">
                  {user.isActive && <span className="user-active-dot" />}
                  <span className="user-initial">
                    {(user.firstName?.[0] || user.username?.[0] || 'U').toUpperCase()}
                  </span>
                </div>
                <div className="user-info">
                  <div className="user-name">{formatUserName(user)}</div>
                  <div className="user-meta">
                    <span className="user-messages">{user.messageCount} messages</span>
                    <span className="user-separator">•</span>
                    <span className="user-lastseen">{formatRelativeTime(user.lastSeen)}</span>
                  </div>
                </div>
                <div className="user-id">#{user.chatId}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Last Updated */}
      <div className="users-footer">
        Last updated: {new Date(analytics.generatedAt).toLocaleTimeString()}
        <button className="btn btn-secondary btn-small" onClick={fetchAnalytics} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}
