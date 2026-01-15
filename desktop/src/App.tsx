import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { LiquidGlassFilters } from './components/LiquidGlassFilters';
import './App.css';

interface BotStatus {
  is_running: boolean;
  uptime_seconds: number;
  pid: number | null;
}

interface Config {
  [key: string]: string;
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
  const [activeTab, setActiveTab] = useState<'status' | 'config'>('status');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Fetch project path on mount
  useEffect(() => {
    invoke<string>('get_project_path').then(setProjectPath);
  }, []);

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
              <button className="btn btn-danger" onClick={stopBot} disabled={loading}>
                {loading ? 'Stopping...' : 'Stop Bot'}
              </button>
            ) : (
              <button className="btn btn-primary" onClick={startBot} disabled={loading}>
                {loading ? 'Starting...' : 'Start Bot'}
              </button>
            )}
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
    </>
  );
}

export default App;
