/**
 * Type definitions for c2me desktop app
 */

// Counter metrics from bot backend
export interface CounterMetrics {
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

// Histogram statistics
export interface HistogramStats {
  sum: number;
  count: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

// Histogram metrics
export interface HistogramMetrics {
  claude_response_time: HistogramStats;
  telegram_send_time: HistogramStats;
  tool_execution_time: HistogramStats;
  message_processing_time: HistogramStats;
}

// Gauge metrics
export interface GaugeMetrics {
  active_sessions: number;
  queue_size: number;
  memory_usage_mb: number;
  uptime_seconds: number;
}

// Session mutex statistics
export interface MutexMetrics {
  acquireCount: number;
  waitCount: number;
  totalWaitTimeMs: number;
  avgWaitTimeMs: number;
}

// Tool discovery metadata
export interface ToolDiscoveryMetrics {
  extractedAt: string | null;
  toolCount: number;
  tools: string[];
  slashCommands: string[];
}

// Redis detailed metrics
export interface RedisMetrics {
  cacheHitCount: number;
  cacheMissCount: number;
  cacheHitRate: number;
  bufferSize: number;
  bufferMaxSize: number;
  bufferUtilization: number;
  healthCheckStatus: 'ok' | 'fail' | 'unknown';
  lastHealthCheck: string | null;
}

// Base metrics snapshot (from /metrics endpoint)
export interface BotMetrics {
  counters: CounterMetrics;
  histograms: HistogramMetrics;
  gauges: GaugeMetrics;
  timestamp: string;
}

// Extended metrics snapshot (from /metrics/extended endpoint)
export interface ExtendedBotMetrics extends BotMetrics {
  mutex: MutexMetrics;
  toolDiscovery: ToolDiscoveryMetrics;
  redis: RedisMetrics;
}
