import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface CounterMetrics {
  messages_received: number;
  messages_sent: number;
  claude_requests: number;
  claude_responses: number;
  tool_uses: number;
  tool_approvals: number;
  tool_rejections: number;
  errors: number;
  rate_limit_hits: number;
}

interface HistogramStats {
  sum: number;
  count: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

interface HistogramMetrics {
  claude_response_time: HistogramStats;
  telegram_send_time: HistogramStats;
  tool_execution_time: HistogramStats;
  message_processing_time: HistogramStats;
}

interface GaugeMetrics {
  active_sessions: number;
  queue_size: number;
  memory_usage_mb: number;
  uptime_seconds: number;
}

interface BotMetrics {
  counters: CounterMetrics;
  histograms: HistogramMetrics;
  gauges: GaugeMetrics;
  timestamp: string;
}

interface MetricsPanelProps {
  isRunning: boolean;
  onStartBot?: () => void;
}

function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
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

export function MetricsPanel({ isRunning, onStartBot }: MetricsPanelProps) {
  const [metrics, setMetrics] = useState<BotMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchMetrics = async () => {
    if (!isRunning) {
      setMetrics(null);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      const data = await invoke<BotMetrics>('fetch_metrics');
      setMetrics(data);
      setError(null);
    } catch (err) {
      // Silently handle connection errors when bot just started
      if (!metrics) {
        setError(null);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, [isRunning]);

  if (!isRunning) {
    return (
      <div className="metrics-panel">
        <div className="metrics-empty">
          <span className="metrics-empty-icon">📊</span>
          <p>Bot is not running</p>
          {onStartBot && (
            <button className="btn btn-primary" onClick={onStartBot}>
              Start Bot
            </button>
          )}
        </div>
      </div>
    );
  }

  if (loading && !metrics) {
    return (
      <div className="metrics-panel">
        <div className="metrics-loading">Loading metrics...</div>
      </div>
    );
  }

  if (error && !metrics) {
    return (
      <div className="metrics-panel">
        <div className="metrics-error">
          <span className="metrics-error-icon">⚠️</span>
          <p>{error}</p>
          <button className="btn btn-secondary btn-small" onClick={fetchMetrics}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!metrics) return null;

  const { counters, histograms, gauges } = metrics;

  return (
    <div className="metrics-panel">
      {/* Gauges - Current State */}
      <div className="metrics-section">
        <h3 className="metrics-section-title">Current State</h3>
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-value">{gauges.active_sessions}</div>
            <div className="metric-label">Active Sessions</div>
          </div>
          <div className="metric-card">
            <div className="metric-value">{gauges.queue_size}</div>
            <div className="metric-label">Queue Size</div>
          </div>
          <div className="metric-card">
            <div className="metric-value">{gauges.memory_usage_mb.toFixed(1)} MB</div>
            <div className="metric-label">Memory Usage</div>
          </div>
          <div className="metric-card">
            <div className="metric-value">{formatUptime(gauges.uptime_seconds)}</div>
            <div className="metric-label">Uptime</div>
          </div>
        </div>
      </div>

      {/* Counters - Totals */}
      <div className="metrics-section">
        <h3 className="metrics-section-title">Message Statistics</h3>
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-value">{counters.messages_received}</div>
            <div className="metric-label">Messages Received</div>
          </div>
          <div className="metric-card">
            <div className="metric-value">{counters.messages_sent}</div>
            <div className="metric-label">Messages Sent</div>
          </div>
          <div className="metric-card">
            <div className="metric-value">{counters.claude_requests}</div>
            <div className="metric-label">Claude Requests</div>
          </div>
          <div className="metric-card">
            <div className="metric-value">{counters.claude_responses}</div>
            <div className="metric-label">Claude Responses</div>
          </div>
        </div>
      </div>

      {/* Tool Usage */}
      <div className="metrics-section">
        <h3 className="metrics-section-title">Tool Usage</h3>
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-value">{counters.tool_uses}</div>
            <div className="metric-label">Tool Uses</div>
          </div>
          <div className="metric-card success">
            <div className="metric-value">{counters.tool_approvals}</div>
            <div className="metric-label">Approvals</div>
          </div>
          <div className="metric-card warning">
            <div className="metric-value">{counters.tool_rejections}</div>
            <div className="metric-label">Rejections</div>
          </div>
          <div className="metric-card error">
            <div className="metric-value">{counters.errors}</div>
            <div className="metric-label">Errors</div>
          </div>
        </div>
      </div>

      {/* Response Times */}
      <div className="metrics-section">
        <h3 className="metrics-section-title">Response Times</h3>
        <div className="metrics-table">
          <div className="metrics-table-header">
            <span>Metric</span>
            <span>P50</span>
            <span>P95</span>
            <span>P99</span>
            <span>Count</span>
          </div>
          <div className="metrics-table-row">
            <span>Claude Response</span>
            <span>{formatDuration(histograms.claude_response_time?.p50 || 0)}</span>
            <span>{formatDuration(histograms.claude_response_time?.p95 || 0)}</span>
            <span>{formatDuration(histograms.claude_response_time?.p99 || 0)}</span>
            <span>{histograms.claude_response_time?.count || 0}</span>
          </div>
          <div className="metrics-table-row">
            <span>Telegram Send</span>
            <span>{formatDuration(histograms.telegram_send_time?.p50 || 0)}</span>
            <span>{formatDuration(histograms.telegram_send_time?.p95 || 0)}</span>
            <span>{formatDuration(histograms.telegram_send_time?.p99 || 0)}</span>
            <span>{histograms.telegram_send_time?.count || 0}</span>
          </div>
          <div className="metrics-table-row">
            <span>Tool Execution</span>
            <span>{formatDuration(histograms.tool_execution_time?.p50 || 0)}</span>
            <span>{formatDuration(histograms.tool_execution_time?.p95 || 0)}</span>
            <span>{formatDuration(histograms.tool_execution_time?.p99 || 0)}</span>
            <span>{histograms.tool_execution_time?.count || 0}</span>
          </div>
          <div className="metrics-table-row">
            <span>Message Processing</span>
            <span>{formatDuration(histograms.message_processing_time?.p50 || 0)}</span>
            <span>{formatDuration(histograms.message_processing_time?.p95 || 0)}</span>
            <span>{formatDuration(histograms.message_processing_time?.p99 || 0)}</span>
            <span>{histograms.message_processing_time?.count || 0}</span>
          </div>
        </div>
      </div>

      {/* Rate Limiting */}
      {counters.rate_limit_hits > 0 && (
        <div className="metrics-section">
          <h3 className="metrics-section-title">Rate Limiting</h3>
          <div className="metrics-grid">
            <div className="metric-card warning">
              <div className="metric-value">{counters.rate_limit_hits}</div>
              <div className="metric-label">Rate Limit Hits</div>
            </div>
          </div>
        </div>
      )}

      {/* Last Updated */}
      <div className="metrics-footer">
        Last updated: {new Date(metrics.timestamp).toLocaleTimeString()}
        <button className="btn btn-secondary btn-small" onClick={fetchMetrics} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}
