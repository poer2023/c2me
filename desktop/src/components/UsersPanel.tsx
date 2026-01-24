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
  onStartBot?: () => void;
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

export function UsersPanel({ isRunning, onStartBot }: UsersPanelProps) {
  const [analytics, setAnalytics] = useState<AnalyticsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const data = await invoke<AnalyticsSnapshot>('fetch_analytics');
      setAnalytics(data);
      setError(null);
    } catch (err) {
      // Show friendly error message instead of technical details
      const errStr = `${err}`;
      if (errStr.includes('error sending request') || errStr.includes('connection')) {
        setError('正在连接机器人服务...');
      } else {
        setError('获取数据失败，请稍后重试');
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    // First load: try to fetch regardless of isRunning (handles external bot case)
    if (!initialLoadDone) {
      fetchAnalytics();
      setInitialLoadDone(true);
    }

    // Don't set up polling if bot is not running
    if (!isRunning) {
      return;
    }

    // Set up polling for subsequent fetches
    const interval = setInterval(fetchAnalytics, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, [isRunning, initialLoadDone]);

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

  // Only show empty state if bot is not running AND we have no data (external bot case)
  if (!isRunning && !analytics && !loading) {
    return (
      <div className="users-panel">
        <div className="users-empty">
          <span className="users-empty-icon">👥</span>
          <p>机器人未运行</p>
          <p className="users-empty-hint">启动机器人后可查看用户统计数据</p>
          {onStartBot && (
            <button className="btn btn-primary" onClick={onStartBot}>
              启动机器人
            </button>
          )}
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
        <div className="users-loading">
          <span className="users-loading-icon">⏳</span>
          <p>{error}</p>
          <p className="users-loading-hint">将在几秒后自动重试...</p>
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
