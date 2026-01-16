import { useEffect, useState, useRef, useMemo, useCallback, type MouseEvent } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { LiquidGlassFilters } from './components/LiquidGlassFilters';
import { MetricsPanel } from './components/MetricsPanel';
import { UsersPanel } from './components/UsersPanel';
import { SetupWizard } from './components/SetupWizard';
import { SettingsPage } from './components/SettingsPage';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
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

function AppContent() {
  const { t } = useSettings();
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
  const [showToken, setShowToken] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [userStoppedBot, setUserStoppedBot] = useState(false); // Track if user manually stopped

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

  // Auto-start bot when setup is complete and bot is not running (only on initial load)
  useEffect(() => {
    // Don't auto-start if user manually stopped the bot
    if (userStoppedBot) return;
    
    if (showWizard === false && projectPath && status && !status.is_running) {
      // Small delay to ensure everything is initialized
      const timer = setTimeout(() => {
        invoke<string>('start_bot', { projectPath }).catch((err) => {
          console.error('Auto-start bot failed:', err);
        });
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [showWizard, projectPath, status?.is_running, userStoppedBot]);

  // Read logs from file (best practice 2026: file-based logging, no emit storm)
  const readLogsFromFile = useCallback(async () => {
    try {
      const content = await readTextFile('bot.log', { baseDir: BaseDirectory.AppLog });
      const lines = content.split('\n').filter(line => line.trim());
      
      // Parse log lines into LogEntry format
      const newLogs: LogEntry[] = lines.slice(-500).map(line => {
        // Log format: [TIMESTAMP LEVEL target] message
        const match = line.match(/^\[(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})[^\]]*\]\[(\w+)\]/);
        if (match) {
          const [, , time, level] = match;
          const message = line.replace(/^\[[^\]]+\]\[\w+\]\s*/, '').trim();
          return {
            level: level.toLowerCase(),
            message: message || line,
            timestamp: time,
          };
        }
        // Fallback for non-standard format
        return {
          level: line.toLowerCase().includes('error') ? 'error' : 'info',
          message: line,
          timestamp: new Date().toLocaleTimeString(),
        };
      });
      
      setLogs(newLogs);
    } catch (error) {
      // File might not exist yet, that's ok
      console.log('Log file not ready:', error);
    }
  }, []);

  // Read logs only when logs tab is active (polling from file)
  useEffect(() => {
    if (activeTab !== 'logs') return;

    // Read immediately when switching to logs tab
    readLogsFromFile();

    // Poll for new logs every 2 seconds (much lighter than emit)
    const pollInterval = setInterval(readLogsFromFile, 2000);

    return () => clearInterval(pollInterval);
  }, [activeTab, readLogsFromFile]);

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
  // Poll status every 2 seconds (reduced from 1s to improve performance)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const botStatus = await invoke<BotStatus>('get_bot_status');
        setStatus(botStatus);
      } catch (error) {
        console.error('Failed to get bot status:', error);
      }
    }, 2000);

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
      // If .env doesn't exist, show empty config form instead of error
      console.warn('Failed to load config:', error);
      setConfig({
        TG_BOT_TOKEN: '',
        CLAUDE_CODE_PATH: '',
        ANTHROPIC_API_KEY: '',
        ANTHROPIC_BASE_URL: '',
        WORK_DIR: '',
        STORAGE_TYPE: 'memory',
        REDIS_URL: '',
        LOG_LEVEL: 'info',
      });
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
    setUserStoppedBot(false); // Reset the flag when user manually starts
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
    setUserStoppedBot(true); // Mark that user manually stopped
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

  const startWindowDrag = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!isTauri() || event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea')) {
      return;
    }

    event.preventDefault();
    void getCurrentWindow().startDragging();
  }, []);

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
      <header className="header" onMouseDown={startWindowDrag}>
        <div className="header-row" data-tauri-drag-region>
          <h1 data-tauri-drag-region>{t('app.title')}</h1>
          <div className="header-actions">
            <button 
              className="settings-btn" 
              onClick={() => setShowSettings(true)}
              title={t('settings.title')}
            >
              ⚙️
            </button>
          </div>
        </div>
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'status' ? 'active' : ''}`}
            onClick={() => setActiveTab('status')}
          >
            {t('tab.status')}
          </button>
          <button
            className={`tab ${activeTab === 'metrics' ? 'active' : ''}`}
            onClick={() => setActiveTab('metrics')}
          >
            {t('tab.metrics')}
          </button>
          <button
            className={`tab ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            {t('tab.users')}
          </button>
          <button
            className={`tab ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            {t('tab.logs')} {logs.length > 0 && <span className="log-count">({logs.length})</span>}
          </button>
          <button
            className={`tab ${activeTab === 'config' ? 'active' : ''}`}
            onClick={() => setActiveTab('config')}
          >
            {t('tab.config')}
          </button>
        </div>
      </header>

      {message && <div className={`message ${message.type}`}>{message.text}</div>}

      {activeTab === 'status' && (
        <div className="status-panel">
          <div className="status-indicator">
            <span className={`status-dot ${status?.is_running ? 'running' : 'stopped'}`} />
            <span className="status-text">{status?.is_running ? t('status.running') : t('status.stopped')}</span>
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label">{t('status.uptime')}</div>
              <div className="stat-value">
                {status?.is_running ? formatUptime(status.uptime_seconds) : '-'}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{t('status.pid')}</div>
              <div className="stat-value">{status?.pid ?? '-'}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{t('status.project')}</div>
              <div className="stat-value path">{projectPath || '-'}</div>
            </div>
          </div>

          <div className="controls">
            {status?.is_running ? (
              <>
                <button className="btn btn-secondary" onClick={restartBot} disabled={loading}>
                  {loading ? t('control.restarting') : t('control.restart')}
                </button>
                <button className="btn btn-danger" onClick={stopBot} disabled={loading}>
                  {loading ? t('control.stopping') : t('control.stop')}
                </button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={startBot} disabled={loading}>
                {loading ? t('control.starting') : t('control.start')}
              </button>
            )}
          </div>
        </div>
      )}

      {activeTab === 'metrics' && (
        <MetricsPanel isRunning={status?.is_running || false} onStartBot={startBot} />
      )}

      {activeTab === 'users' && (
        <UsersPanel isRunning={status?.is_running || false} onStartBot={startBot} />
      )}

      {activeTab === 'logs' && (
        <div className="logs-panel">
          <div className="logs-header">
            <span className="logs-title">{t('logs.title')}</span>
            <button
              className="btn btn-secondary btn-small"
              onClick={() => setLogs([])}
              disabled={logs.length === 0}
            >
              {t('logs.clear')}
            </button>
          </div>
          <div className="logs-filters">
            <input
              type="text"
              className="log-filter-input"
              placeholder={t('logs.search')}
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
                  ? t('logs.empty')
                  : t('logs.noMatch')}
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
            <label>{t('config.token')}</label>
            <div className="input-with-button">
              <input
                type={showToken ? 'text' : 'password'}
                value={config.TG_BOT_TOKEN || ''}
                onChange={(e) => updateConfig('TG_BOT_TOKEN', e.target.value)}
                placeholder={t('config.tokenPlaceholder')}
              />
              <button
                type="button"
                className="btn btn-small btn-icon"
                onClick={() => setShowToken(!showToken)}
                title={showToken ? 'Hide token' : 'Show token'}
              >
                {showToken ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          <div className="form-group">
            <label>{t('config.claudePath')}</label>
            <input
              type="text"
              value={config.CLAUDE_CODE_PATH || ''}
              onChange={(e) => updateConfig('CLAUDE_CODE_PATH', e.target.value)}
              placeholder="/path/to/claude"
            />
          </div>

          <div className="form-group">
            <label>{t('config.apiKey')}</label>
            <div className="input-with-button">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={config.ANTHROPIC_API_KEY || ''}
                onChange={(e) => updateConfig('ANTHROPIC_API_KEY', e.target.value)}
                placeholder="sk-ant-api03-..."
              />
              <button
                type="button"
                className="btn btn-small btn-icon"
                onClick={() => setShowApiKey(!showApiKey)}
                title={showApiKey ? 'Hide API key' : 'Show API key'}
              >
                {showApiKey ? '🙈' : '👁️'}
              </button>
            </div>
            <p className="form-hint">{t('config.apiKeyHint')}</p>
          </div>

          <div className="form-group">
            <label>{t('config.baseUrl')}</label>
            <input
              type="text"
              value={config.ANTHROPIC_BASE_URL || ''}
              onChange={(e) => updateConfig('ANTHROPIC_BASE_URL', e.target.value)}
              placeholder="https://api.anthropic.com (leave empty for default)"
            />
            <p className="form-hint">{t('config.baseUrlHint')}</p>
          </div>

          <div className="form-group">
            <label>{t('config.workDir')}</label>
            <input
              type="text"
              value={config.WORK_DIR || ''}
              onChange={(e) => updateConfig('WORK_DIR', e.target.value)}
              placeholder="/path/to/workdir"
            />
          </div>

          <div className="form-group">
            <label>{t('config.storageType')}</label>
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
              <label>{t('config.redisUrl')}</label>
              <input
                type="text"
                value={config.REDIS_URL || ''}
                onChange={(e) => updateConfig('REDIS_URL', e.target.value)}
                placeholder="redis://localhost:6379"
              />
            </div>
          )}

          <div className="form-group">
            <label>{t('config.logLevel')}</label>
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
                    showMessage('success', enabled ? t('msg.autostartEnabled') : t('msg.autostartDisabled'));
                  } catch (error) {
                    showMessage('error', `${t('msg.failedAutostart')}: ${error}`);
                  }
                }}
              />
              <span>{t('config.autostart')}</span>
            </label>
            <p className="form-hint">{t('config.autostartHint')}</p>
          </div>

          <div className="controls">
            <button className="btn btn-secondary" onClick={loadConfig} disabled={loading}>
              {t('config.reload')}
            </button>
            <button className="btn btn-primary" onClick={saveConfig} disabled={loading}>
              {loading ? t('config.saving') : t('config.save')}
            </button>
          </div>
        </div>
      )}

      {/* Settings Overlay */}
      {showSettings && (
        <div className="settings-overlay" onClick={() => setShowSettings(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <SettingsPage onClose={() => setShowSettings(false)} />
          </div>
        </div>
      )}
    </div>
    )}
    </>
  );
}

function App() {
  return (
    <SettingsProvider>
      <AppContent />
    </SettingsProvider>
  );
}

export default App;
