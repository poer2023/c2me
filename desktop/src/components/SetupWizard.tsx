import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface PrerequisiteStatus {
  node_installed: boolean;
  node_version: string | null;
  pnpm_installed: boolean;
  pnpm_version: string | null;
  project_exists: boolean;
  dependencies_installed: boolean;
  env_configured: boolean;
}

interface InstallProgress {
  stage: string;
  message: string;
  progress: number;
}

interface SetupWizardProps {
  projectPath: string;
  onComplete: () => void;
}

export function SetupWizard({ projectPath, onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [prerequisites, setPrerequisites] = useState<PrerequisiteStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [claudePathDetected, setClaudePathDetected] = useState(false);
  const [detectingClaudePath, setDetectingClaudePath] = useState(false);

  // Config state
  const [config, setConfig] = useState({
    TG_BOT_TOKEN: '',
    CLAUDE_CODE_PATH: '',
    WORK_DIR: '',
    STORAGE_TYPE: 'memory',
  });

  // Check prerequisites on mount
  useEffect(() => {
    checkPrerequisites();
  }, [projectPath]);

  // Listen for install progress events
  useEffect(() => {
    const unlisten = listen<InstallProgress>('install-progress', (event) => {
      setInstallProgress(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const checkPrerequisites = async () => {
    setLoading(true);
    try {
      const status = await invoke<PrerequisiteStatus>('check_prerequisites', { projectPath });
      setPrerequisites(status);
    } catch (e) {
      setError(`Failed to check prerequisites: ${e}`);
    }
    setLoading(false);
  };

  const installPnpm = async () => {
    setLoading(true);
    setError(null);
    try {
      await invoke('install_pnpm');
      await checkPrerequisites();
    } catch (e) {
      setError(`Failed to install pnpm: ${e}`);
    }
    setLoading(false);
  };

  const installDependencies = async () => {
    setLoading(true);
    setError(null);
    setInstallProgress(null);
    try {
      await invoke('install_dependencies', { projectPath });
      await checkPrerequisites();
    } catch (e) {
      setError(`Failed to install dependencies: ${e}`);
    }
    setLoading(false);
  };

  const saveConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      await invoke('create_env_file', { projectPath, config });
      await checkPrerequisites();
      setStep(3);
    } catch (e) {
      setError(`Failed to save configuration: ${e}`);
    }
    setLoading(false);
  };

  const detectClaudePath = async () => {
    setDetectingClaudePath(true);
    try {
      const path = await invoke<string>('detect_claude_code_path');
      if (path) {
        setConfig({ ...config, CLAUDE_CODE_PATH: path });
        setClaudePathDetected(true);
      }
    } catch (e) {
      // Silent fail - user can enter manually
      console.log('Could not auto-detect Claude path:', e);
    }
    setDetectingClaudePath(false);
  };

  const completeSetup = async () => {
    setLoading(true);
    try {
      await invoke('mark_setup_complete');
      onComplete();
    } catch (e) {
      setError(`Failed to complete setup: ${e}`);
    }
    setLoading(false);
  };

  const steps = [
    { title: 'Welcome', icon: '👋' },
    { title: 'Prerequisites', icon: '🔧' },
    { title: 'Configuration', icon: '⚙️' },
    { title: 'Install', icon: '📦' },
    { title: 'Complete', icon: '✅' },
  ];

  const canProceed = () => {
    if (!prerequisites) return false;

    switch (step) {
      case 0:
        return true;
      case 1:
        return prerequisites.node_installed && prerequisites.pnpm_installed;
      case 2:
        return config.TG_BOT_TOKEN.length > 0 && config.CLAUDE_CODE_PATH.length > 0;
      case 3:
        return prerequisites.dependencies_installed;
      case 4:
        return true;
      default:
        return false;
    }
  };

  return (
    <div className="wizard-overlay">
      <div className="wizard-container">
        <div className="wizard-header">
          <h1>ChatCode Setup</h1>
          <div className="wizard-steps">
            {steps.map((s, i) => (
              <div
                key={i}
                className={`wizard-step ${i === step ? 'active' : ''} ${i < step ? 'completed' : ''}`}
              >
                <span className="step-icon">{i < step ? '✓' : s.icon}</span>
                <span className="step-title">{s.title}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="wizard-content">
          {error && <div className="wizard-error">{error}</div>}

          {step === 0 && (
            <div className="wizard-welcome">
              <h2>Welcome to ChatCode! 🎉</h2>
              <p>
                ChatCode is a Telegram bot that integrates with Claude Code, providing AI-powered
                coding assistance directly in Telegram.
              </p>
              <p>This wizard will help you set up everything in just a few minutes:</p>
              <ul>
                <li>✅ Check required software (Node.js, pnpm)</li>
                <li>✅ Configure your bot credentials</li>
                <li>✅ Install dependencies</li>
                <li>✅ Start using ChatCode!</li>
              </ul>
            </div>
          )}

          {step === 1 && prerequisites && (
            <div className="wizard-prerequisites">
              <h2>Prerequisites Check</h2>
              <div className="prereq-list">
                <div className={`prereq-item ${prerequisites.node_installed ? 'ok' : 'missing'}`}>
                  <span className="prereq-icon">
                    {prerequisites.node_installed ? '✅' : '❌'}
                  </span>
                  <div className="prereq-info">
                    <span className="prereq-name">Node.js</span>
                    <span className="prereq-version">
                      {prerequisites.node_version || 'Not installed'}
                    </span>
                  </div>
                  {!prerequisites.node_installed && (
                    <a
                      href="https://nodejs.org/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-small"
                    >
                      Download
                    </a>
                  )}
                </div>

                <div className={`prereq-item ${prerequisites.pnpm_installed ? 'ok' : 'missing'}`}>
                  <span className="prereq-icon">
                    {prerequisites.pnpm_installed ? '✅' : '❌'}
                  </span>
                  <div className="prereq-info">
                    <span className="prereq-name">pnpm</span>
                    <span className="prereq-version">
                      {prerequisites.pnpm_version || 'Not installed'}
                    </span>
                  </div>
                  {!prerequisites.pnpm_installed && prerequisites.node_installed && (
                    <button
                      className="btn btn-small btn-primary"
                      onClick={installPnpm}
                      disabled={loading}
                    >
                      {loading ? 'Installing...' : 'Install'}
                    </button>
                  )}
                </div>

                <div className={`prereq-item ${prerequisites.project_exists ? 'ok' : 'missing'}`}>
                  <span className="prereq-icon">
                    {prerequisites.project_exists ? '✅' : '❌'}
                  </span>
                  <div className="prereq-info">
                    <span className="prereq-name">Project Files</span>
                    <span className="prereq-version">{projectPath}</span>
                  </div>
                </div>
              </div>

              <button
                className="btn btn-secondary"
                onClick={checkPrerequisites}
                disabled={loading}
              >
                {loading ? 'Checking...' : 'Refresh'}
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="wizard-config">
              <h2>Bot Configuration</h2>
              <p>Enter your Telegram bot credentials and Claude Code path.</p>

              <div className="form-group">
                <label>
                  Telegram Bot Token <span className="required">*</span>
                </label>
                <div className="input-with-button">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={config.TG_BOT_TOKEN}
                    onChange={(e) => setConfig({ ...config, TG_BOT_TOKEN: e.target.value })}
                    placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
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
                <p className="form-hint">
                  Get your token from{' '}
                  <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">
                    @BotFather
                  </a>
                </p>
              </div>

              <div className="form-group">
                <label>
                  Claude Code Path <span className="required">*</span>
                </label>
                <div className="input-with-button">
                  <input
                    type="text"
                    value={config.CLAUDE_CODE_PATH}
                    onChange={(e) => {
                      setConfig({ ...config, CLAUDE_CODE_PATH: e.target.value });
                      setClaudePathDetected(false);
                    }}
                    placeholder="/usr/local/bin/claude"
                  />
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={detectClaudePath}
                    disabled={detectingClaudePath}
                  >
                    {detectingClaudePath ? '...' : '🔍 Detect'}
                  </button>
                </div>
                <p className="form-hint">
                  {claudePathDetected
                    ? '✅ Claude Code path auto-detected!'
                    : 'Path to your Claude Code binary. Click Detect or run `which claude` to find it.'}
                </p>
              </div>

              <div className="form-group">
                <label>Work Directory</label>
                <input
                  type="text"
                  value={config.WORK_DIR}
                  onChange={(e) => setConfig({ ...config, WORK_DIR: e.target.value })}
                  placeholder="/path/to/projects"
                />
                <p className="form-hint">Directory where bot will manage project files.</p>
              </div>

              <div className="form-group">
                <label>Storage Type</label>
                <select
                  value={config.STORAGE_TYPE}
                  onChange={(e) => setConfig({ ...config, STORAGE_TYPE: e.target.value })}
                >
                  <option value="memory">Memory (for testing)</option>
                  <option value="redis">Redis (for production)</option>
                </select>
              </div>
            </div>
          )}

          {step === 3 && prerequisites && (
            <div className="wizard-install">
              <h2>Install Dependencies</h2>

              {prerequisites.dependencies_installed ? (
                <div className="install-complete">
                  <span className="install-icon">✅</span>
                  <p>Dependencies are already installed!</p>
                </div>
              ) : (
                <>
                  <p>Click the button below to install all required packages.</p>

                  {installProgress && (
                    <div className="install-progress">
                      <div className="progress-bar">
                        <div
                          className="progress-fill"
                          style={{ width: `${installProgress.progress}%` }}
                        />
                      </div>
                      <p className="progress-message">{installProgress.message}</p>
                    </div>
                  )}

                  <button
                    className="btn btn-primary btn-large"
                    onClick={installDependencies}
                    disabled={loading}
                  >
                    {loading ? 'Installing...' : '📦 Install Dependencies'}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setStep(4)}
                    disabled={loading}
                  >
                    Skip (I'll install manually)
                  </button>
                </>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="wizard-complete">
              <h2>Setup Complete! 🎉</h2>
              <p>Your ChatCode bot is ready to use. Here's what you can do:</p>
              <ul>
                <li>🚀 Start the bot from the dashboard or tray menu</li>
                <li>💬 Send messages to your Telegram bot</li>
                <li>⌨️ Use Cmd+Shift+C to quickly toggle the bot</li>
                <li>📊 View metrics and logs in the dashboard</li>
              </ul>
              <p className="tip">
                💡 Tip: Enable "Launch at startup" in Settings to have ChatCode always ready!
              </p>
            </div>
          )}
        </div>

        <div className="wizard-footer">
          {step > 0 && step < 4 && (
            <button className="btn btn-secondary" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <div className="spacer" />
          {step < 4 ? (
            <button
              className="btn btn-primary"
              onClick={() => {
                if (step === 2) {
                  saveConfig();
                } else {
                  setStep(step + 1);
                }
              }}
              disabled={!canProceed() || loading}
            >
              {step === 2 ? 'Save & Continue' : 'Continue'}
            </button>
          ) : (
            <button className="btn btn-primary btn-large" onClick={completeSetup} disabled={loading}>
              {loading ? 'Finishing...' : 'Get Started'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
