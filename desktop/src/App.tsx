import { useEffect, useState, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { LiquidGlassFilters } from './components/LiquidGlassFilters';
import { MetricsPanel } from './components/MetricsPanel';
import { UsersPanel } from './components/UsersPanel';
import { SetupWizard } from './components/SetupWizard';
import './App.css';

interface BotStatus {
  is_running: boolean;
  uptime_seconds: number;
  pid: number | null;
}

interface Config {
  [key: string]: string;
}

interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

function App() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [projectPath, setProjectPath] = useState<string>('');
  const [config, setConfig] = useState<Config | null>(null);
  const [activeTab, setActiveTab] = useState<'status' | 'logs' | 'metrics' | 'users' | 'config'>('status');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [autostart, setAutostart] = useState<boolean>(false);
  const [showWizard, setShowWizard] = useState<boolean | null>(null); // null = loading

  // Log filtering state
  const [logSearch, setLogSearch] = useState<string>('');
  const [logLevelFilter, setLogLevelFilter] = useState<Set<string>>(new Set(['info', 'warn', 'error']));

  // Filtered logs based on search and level filters
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // Level filter
      if (!logLevelFilter.has(log.level.toLowerCase())) {
        return false;
      }
      // Search filter
      if (logSearch && !log.message.toLowerCase().includes(logSearch.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [logs, logSearch, logLevelFilter]);

  const toggleLogLevel = (level: string) => {
    setLogLevelFilter(prev => {
      const newSet = new Set(prev);
      if (newSet.has(level)) {
        newSet.delete(level);
      } else {
        newSet.add(level);
      }
      return newSet;
    });
  };

  // Fetch project path and autostart status on mount
  useEffect(() => {
    invoke<string>('get_project_path').then(setProjectPath);
    invoke<boolean>('get_autostart_enabled').then(setAutostart).catch(() => setAutostart(false));
    // Check if setup is complete
    invoke<boolean>('check_setup_complete').then((complete) => {
      setShowWizard(!complete);
    }).catch(() => setShowWizard(true));
  }, []);

  // Listen for log events
  useEffect(() => {
    const unlisten = listen<LogEntry>('bot-log', (event) => {
      setLogs((prev) => [...prev.slice(-499), event.payload]); // Keep last 500 logs
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for menu events (from native macOS menu bar)
  useEffect(() => {
    const unlistenLogs = listen('show-logs', () => {
      setActiveTab('logs');
    });
    const unlistenSettings = listen('show-settings', () => {
      setActiveTab('config');
    });
    const unlistenStatus = listen<string>('bot-status', (event) => {
      showMessage('success', event.payload);
    });
    const unlistenError = listen<string>('bot-error', (event) => {
      showMessage('error', event.payload);
    });

    return () => {
      unlistenLogs.then((fn) => fn());
      unlistenSettings.then((fn) => fn());
      unlistenStatus.then((fn) => fn());
      unlistenError.then((fn) => fn());
    };
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    if (activeTab === 'logs') {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeTab]);

  // Poll status every second
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const botStatus = await invoke<BotStatus>('get_bot_status');
        setStatus(botStatus);
      } catch (error) {
        console.error('Failed to get bot status:', error);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Load config when switching to config tab
  useEffect(() => {
    if (activeTab === 'config' && projectPath) {
      loadConfig();
    }
  }, [activeTab, projectPath]);

  const loadConfig = async () => {
    try {
      const cfg = await invoke<Config>('load_config', { projectPath });
      setConfig(cfg);
    } catch (error) {
      showMessage('error', `Failed to load config: ${error}`);
    }
  };

  const saveConfig = async () => {
    if (!config) return;

    setLoading(true);
    try {
      await invoke('save_config', { projectPath, config });
      showMessage('success', 'Configuration saved successfully');
    } catch (error) {
      showMessage('error', `Failed to save config: ${error}`);
    }
    setLoading(false);
  };

  const startBot = async () => {
    setLoading(true);
    try {
      const result = await invoke<string>('start_bot', { projectPath });
      showMessage('success', result);
    } catch (error) {
      showMessage('error', `${error}`);
    }
    setLoading(false);
  };

  const stopBot = async () => {
    setLoading(true);
    try {
      const result = await invoke<string>('stop_bot');
      showMessage('success', result);
    } catch (error) {
      showMessage('error', `${error}`);
    }
    setLoading(false);
  };

  const restartBot = async () => {
    setLoading(true);
    try {
      const result = await invoke<string>('restart_bot', { projectPath });
      showMessage('success', result);
    } catch (error) {
      showMessage('error', `${error}`);
    }
    setLoading(false);
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const updateConfig = (key: string, value: string) => {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : null));
  };

  return (
    <>
      {/* SVG filters for Liquid Glass refraction effects */}
      <LiquidGlassFilters />

      {/* Setup Wizard */}
      {showWizard === null ? (
        <div className="loading-screen">
          <div className="loading-spinner" />
          <p>Loading...</p>
        </div>
      ) : showWizard ? (
        <SetupWizard
          projectPath={projectPath}
          onComplete={() => setShowWizard(false)}
        />
      ) : (
      <div className="container">
      <header className="header">
        <h1>ChatCode Dashboard</h1>
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'status' ? 'active' : ''}`}
            onClick={() => setActiveTab('status')}
          >
            Status
          </button>
          <button
            className={`tab ${activeTab === 'metrics' ? 'active' : ''}`}
            onClick={() => setActiveTab('metrics')}
          >
            Metrics
          </button>
          <button
            className={`tab ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            Users
          </button>
          <button
            className={`tab ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            Logs {logs.length > 0 && <span className="log-count">({logs.length})</span>}
          </button>
          <button
            className={`tab ${activeTab === 'config' ? 'active' : ''}`}
            onClick={() => setActiveTab('config')}
          >
            Configuration
          </button>
        </div>
      </header>

      {message && <div className={`message ${message.type}`}>{message.text}</div>}

      {activeTab === 'status' && (
        <div className="status-panel">
          <div className="status-indicator">
            <span className={`status-dot ${status?.is_running ? 'running' : 'stopped'}`} />
            <span className="status-text">{status?.is_running ? 'Running' : 'Stopped'}</span>
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label">Uptime</div>
              <div className="stat-value">
                {status?.is_running ? formatUptime(status.uptime_seconds) : '-'}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">PID</div>
              <div className="stat-value">{status?.pid ?? '-'}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Project</div>
              <div className="stat-value path">{projectPath || '-'}</div>
            </div>
          </div>

          <div className="controls">
            {status?.is_running ? (
              <>
                <button className="btn btn-secondary" onClick={restartBot} disabled={loading}>
                  {loading ? 'Restarting...' : 'Restart Bot'}
                </button>
                <button className="btn btn-danger" onClick={stopBot} disabled={loading}>
                  {loading ? 'Stopping...' : 'Stop Bot'}
                </button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={startBot} disabled={loading}>
                {loading ? 'Starting...' : 'Start Bot'}
              </button>
            )}
          </div>
        </div>
      )}

      {activeTab === 'metrics' && (
        <MetricsPanel isRunning={status?.is_running || false} />
      )}

      {activeTab === 'users' && (
        <UsersPanel isRunning={status?.is_running || false} />
      )}

      {activeTab === 'logs' && (
        <div className="logs-panel">
          <div className="logs-header">
            <span className="logs-title">Bot Logs</span>
            <button
              className="btn btn-secondary btn-small"
              onClick={() => setLogs([])}
              disabled={logs.length === 0}
            >
              Clear Logs
            </button>
          </div>
          <div className="logs-filters">
            <input
              type="text"
              className="log-filter-input"
              placeholder="Search logs..."
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
            />
            <div className="log-level-filters">
              <button
                className={`log-level-btn level-info ${logLevelFilter.has('info') ? 'active' : ''}`}
                onClick={() => toggleLogLevel('info')}
              >
                INFO
              </button>
              <button
                className={`log-level-btn level-warn ${logLevelFilter.has('warn') ? 'active' : ''}`}
                onClick={() => toggleLogLevel('warn')}
              >
                WARN
              </button>
              <button
                className={`log-level-btn level-error ${logLevelFilter.has('error') ? 'active' : ''}`}
                onClick={() => toggleLogLevel('error')}
              >
                ERROR
              </button>
            </div>
          </div>
          <div className="logs-container">
            {filteredLogs.length === 0 ? (
              <div className="logs-empty">
                {logs.length === 0
                  ? 'No logs yet. Start the bot to see logs.'
                  : 'No logs match your filters.'}
              </div>
            ) : (
              filteredLogs.map((log, index) => (
                <div key={index} className={`log-entry log-${log.level}`}>
                  <span className="log-timestamp">{log.timestamp}</span>
                  <span className={`log-level log-level-${log.level}`}>{log.level.toUpperCase()}</span>
                  <span className="log-message">{log.message}</span>
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}

      {activeTab === 'config' && config && (
        <div className="config-panel">
          <div className="form-group">
            <label>Telegram Bot Token</label>
            <input
              type="password"
              value={config.TG_BOT_TOKEN || ''}
              onChange={(e) => updateConfig('TG_BOT_TOKEN', e.target.value)}
              placeholder="Enter your Telegram bot token"
            />
          </div>

          <div className="form-group">
            <label>Claude Code Path</label>
            <input
              type="text"
              value={config.CLAUDE_CODE_PATH || ''}
              onChange={(e) => updateConfig('CLAUDE_CODE_PATH', e.target.value)}
              placeholder="/path/to/claude"
            />
          </div>

          <div className="form-group">
            <label>Work Directory</label>
            <input
              type="text"
              value={config.WORK_DIR || ''}
              onChange={(e) => updateConfig('WORK_DIR', e.target.value)}
              placeholder="/path/to/workdir"
            />
          </div>

          <div className="form-group">
            <label>Storage Type</label>
            <select
              value={config.STORAGE_TYPE || 'memory'}
              onChange={(e) => updateConfig('STORAGE_TYPE', e.target.value)}
            >
              <option value="memory">Memory</option>
              <option value="redis">Redis</option>
            </select>
          </div>

          {config.STORAGE_TYPE === 'redis' && (
            <div className="form-group">
              <label>Redis URL</label>
              <input
                type="text"
                value={config.REDIS_URL || ''}
                onChange={(e) => updateConfig('REDIS_URL', e.target.value)}
                placeholder="redis://localhost:6379"
              />
            </div>
          )}

          <div className="form-group">
            <label>Log Level</label>
            <select
              value={config.LOG_LEVEL || 'info'}
              onChange={(e) => updateConfig('LOG_LEVEL', e.target.value)}
            >
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={autostart}
                onChange={async (e) => {
                  const enabled = e.target.checked;
                  try {
                    await invoke('set_autostart_enabled', { enabled });
                    setAutostart(enabled);
                    showMessage('success', enabled ? 'Auto-start enabled' : 'Auto-start disabled');
                  } catch (error) {
                    showMessage('error', `Failed to set auto-start: ${error}`);
                  }
                }}
              />
              <span>Launch at startup</span>
            </label>
            <p className="form-hint">Automatically start ChatCode when you log in</p>
          </div>

          <div className="controls">
            <button className="btn btn-secondary" onClick={loadConfig} disabled={loading}>
              Reload
            </button>
            <button className="btn btn-primary" onClick={saveConfig} disabled={loading}>
              {loading ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </div>
      )}
    </div>
    )}
    </>
  );
}

export default App;
