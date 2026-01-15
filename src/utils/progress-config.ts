/**
 * ProgressConfig - Configuration management for progress tracking
 *
 * Provides user-configurable settings for progress display behavior,
 * with persistent storage and Telegram interface integration.
 */

export interface ProgressSettings {
  /** Enable/disable progress tracking */
  enabled: boolean;
  /** Minimum interval between message edits (ms) */
  minEditInterval: number;
  /** Interval for typing heartbeat (ms) */
  heartbeatInterval: number;
  /** Interval for automatic status updates (ms) */
  statusUpdateInterval: number;
  /** Show tool details in progress */
  showToolDetails: boolean;
  /** Show elapsed time */
  showElapsedTime: boolean;
  /** Auto-pause on rate limit (429 error) */
  autoPauseOnRateLimit: boolean;
  /** Dynamic interval adjustment */
  dynamicIntervalAdjustment: boolean;
}

export interface ProgressStats {
  /** Total progress sessions started */
  totalSessions: number;
  /** Currently active sessions */
  activeSessions: number;
  /** Total 429 errors encountered */
  rateLimitErrors: number;
  /** Total successful completions */
  successfulCompletions: number;
  /** Total failed completions */
  failedCompletions: number;
  /** Current pause state */
  isPaused: boolean;
  /** Pause until timestamp (if paused) */
  pauseUntil: number | null;
  /** Last error message */
  lastError: string | null;
  /** Average session duration (ms) */
  avgSessionDuration: number;
}

// Default settings
export const DEFAULT_PROGRESS_SETTINGS: ProgressSettings = {
  enabled: true,
  minEditInterval: 3000,
  heartbeatInterval: 4000,
  statusUpdateInterval: 5000,
  showToolDetails: true,
  showElapsedTime: true,
  autoPauseOnRateLimit: true,
  dynamicIntervalAdjustment: true,
};

// Telegram API safe limits
export const SAFE_LIMITS = {
  MIN_EDIT_INTERVAL: 2000,      // Minimum 2 seconds between edits
  MAX_EDIT_INTERVAL: 30000,     // Maximum 30 seconds
  MIN_HEARTBEAT: 3000,          // Minimum 3 seconds heartbeat
  MAX_HEARTBEAT: 10000,         // Maximum 10 seconds
  MIN_STATUS_UPDATE: 3000,      // Minimum 3 seconds
  MAX_STATUS_UPDATE: 60000,     // Maximum 60 seconds
};

/**
 * Validate and clamp settings to safe limits
 */
export function validateSettings(settings: Partial<ProgressSettings>): ProgressSettings {
  const validated = { ...DEFAULT_PROGRESS_SETTINGS, ...settings };

  // Clamp intervals to safe ranges
  validated.minEditInterval = Math.max(
    SAFE_LIMITS.MIN_EDIT_INTERVAL,
    Math.min(SAFE_LIMITS.MAX_EDIT_INTERVAL, validated.minEditInterval)
  );

  validated.heartbeatInterval = Math.max(
    SAFE_LIMITS.MIN_HEARTBEAT,
    Math.min(SAFE_LIMITS.MAX_HEARTBEAT, validated.heartbeatInterval)
  );

  validated.statusUpdateInterval = Math.max(
    SAFE_LIMITS.MIN_STATUS_UPDATE,
    Math.min(SAFE_LIMITS.MAX_STATUS_UPDATE, validated.statusUpdateInterval)
  );

  // Ensure status update >= min edit interval
  if (validated.statusUpdateInterval < validated.minEditInterval) {
    validated.statusUpdateInterval = validated.minEditInterval;
  }

  return validated;
}

/**
 * Format settings for display
 */
export function formatSettingsDisplay(settings: ProgressSettings): string {
  const statusEmoji = settings.enabled ? '✅' : '❌';

  return `📊 **Progress Tracking Settings**

${statusEmoji} Status: ${settings.enabled ? 'Enabled' : 'Disabled'}

⏱️ **Intervals:**
• Message Edit: ${settings.minEditInterval / 1000}s
• Heartbeat: ${settings.heartbeatInterval / 1000}s
• Status Update: ${settings.statusUpdateInterval / 1000}s

🔧 **Display Options:**
• Tool Details: ${settings.showToolDetails ? '✅' : '❌'}
• Elapsed Time: ${settings.showElapsedTime ? '✅' : '❌'}

🛡️ **Protection:**
• Auto-pause on Rate Limit: ${settings.autoPauseOnRateLimit ? '✅' : '❌'}
• Dynamic Interval: ${settings.dynamicIntervalAdjustment ? '✅' : '❌'}`;
}

/**
 * Format statistics for display
 */
export function formatStatsDisplay(stats: ProgressStats): string {
  const pauseStatus = stats.isPaused
    ? `⏸️ Paused until ${new Date(stats.pauseUntil || 0).toLocaleTimeString()}`
    : '▶️ Running';

  const avgDuration = stats.avgSessionDuration > 0
    ? `${(stats.avgSessionDuration / 1000).toFixed(1)}s`
    : 'N/A';

  return `📈 **Progress Tracking Statistics**

${pauseStatus}

📊 **Sessions:**
• Total: ${stats.totalSessions}
• Active: ${stats.activeSessions}
• Successful: ${stats.successfulCompletions}
• Failed: ${stats.failedCompletions}

⚠️ **Rate Limits:**
• 429 Errors: ${stats.rateLimitErrors}
${stats.lastError ? `• Last Error: ${stats.lastError}` : ''}

⏱️ **Performance:**
• Avg Duration: ${avgDuration}`;
}

/**
 * Get preset configurations
 */
export function getPreset(name: 'safe' | 'balanced' | 'aggressive'): ProgressSettings {
  switch (name) {
    case 'safe':
      return {
        ...DEFAULT_PROGRESS_SETTINGS,
        minEditInterval: 5000,
        heartbeatInterval: 5000,
        statusUpdateInterval: 10000,
      };
    case 'balanced':
      return DEFAULT_PROGRESS_SETTINGS;
    case 'aggressive':
      return {
        ...DEFAULT_PROGRESS_SETTINGS,
        minEditInterval: 2000,
        heartbeatInterval: 3000,
        statusUpdateInterval: 3000,
      };
    default:
      return DEFAULT_PROGRESS_SETTINGS;
  }
}
