/**
 * Performance Metrics Collection Module
 *
 * Provides counters, histograms, and gauges for monitoring
 * application performance and behavior.
 */

import { logger } from './logger';

// Types
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

export interface HistogramData {
  values: number[];
  sum: number;
  count: number;
  min: number;
  max: number;
}

export interface HistogramMetrics {
  claude_response_time: HistogramData;
  telegram_send_time: HistogramData;
  tool_execution_time: HistogramData;
  message_processing_time: HistogramData;
}

export interface GaugeMetrics {
  active_sessions: number;
  queue_size: number;
  memory_usage_mb: number;
  uptime_seconds: number;
}

export interface MetricsSnapshot {
  counters: CounterMetrics;
  histograms: Record<keyof HistogramMetrics, Omit<HistogramData, 'values'> & { p50: number; p95: number; p99: number }>;
  gauges: GaugeMetrics;
  timestamp: string;
}

// Default histogram data
function createHistogramData(): HistogramData {
  return {
    values: [],
    sum: 0,
    count: 0,
    min: Infinity,
    max: -Infinity,
  };
}

// Calculate percentile
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Metrics Collector Class
 *
 * Thread-safe metrics collection with automatic memory management.
 */
class MetricsCollector {
  private counters: CounterMetrics = {
    messages_received: 0,
    messages_sent: 0,
    claude_requests: 0,
    claude_responses: 0,
    tool_uses: 0,
    tool_approvals: 0,
    tool_rejections: 0,
    errors: 0,
    rate_limit_hits: 0,
  };

  private histograms: HistogramMetrics = {
    claude_response_time: createHistogramData(),
    telegram_send_time: createHistogramData(),
    tool_execution_time: createHistogramData(),
    message_processing_time: createHistogramData(),
  };

  private gauges: GaugeMetrics = {
    active_sessions: 0,
    queue_size: 0,
    memory_usage_mb: 0,
    uptime_seconds: 0,
  };

  private startTime: number = Date.now();
  private maxHistogramSize: number = 1000; // Keep last 1000 values

  // Counter operations
  increment(counter: keyof CounterMetrics, value: number = 1): void {
    this.counters[counter] += value;
  }

  getCounter(counter: keyof CounterMetrics): number {
    return this.counters[counter];
  }

  // Histogram operations
  recordHistogram(histogram: keyof HistogramMetrics, value: number): void {
    const h = this.histograms[histogram];
    h.values.push(value);
    h.sum += value;
    h.count++;
    h.min = Math.min(h.min, value);
    h.max = Math.max(h.max, value);

    // Trim to max size (sliding window)
    if (h.values.length > this.maxHistogramSize) {
      const removed = h.values.shift()!;
      h.sum -= removed;
      // Note: min/max become approximate after trimming
    }
  }

  // Timer helper for histograms
  startTimer(histogram: keyof HistogramMetrics): () => number {
    const start = process.hrtime.bigint();
    return () => {
      const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000; // ms
      this.recordHistogram(histogram, elapsed);
      return elapsed;
    };
  }

  // Gauge operations
  setGauge(gauge: keyof GaugeMetrics, value: number): void {
    this.gauges[gauge] = value;
  }

  incrementGauge(gauge: keyof GaugeMetrics, value: number = 1): void {
    this.gauges[gauge] += value;
  }

  decrementGauge(gauge: keyof GaugeMetrics, value: number = 1): void {
    this.gauges[gauge] = Math.max(0, this.gauges[gauge] - value);
  }

  getGauge(gauge: keyof GaugeMetrics): number {
    return this.gauges[gauge];
  }

  // Update memory usage
  updateMemoryUsage(): void {
    const usage = process.memoryUsage();
    this.gauges.memory_usage_mb = Math.round((usage.heapUsed / 1024 / 1024) * 100) / 100;
  }

  // Update uptime
  updateUptime(): void {
    this.gauges.uptime_seconds = Math.floor((Date.now() - this.startTime) / 1000);
  }

  // Get snapshot of all metrics
  getSnapshot(): MetricsSnapshot {
    this.updateMemoryUsage();
    this.updateUptime();

    const histogramStats: MetricsSnapshot['histograms'] = {} as MetricsSnapshot['histograms'];

    for (const key of Object.keys(this.histograms) as (keyof HistogramMetrics)[]) {
      const h = this.histograms[key];
      histogramStats[key] = {
        sum: h.sum,
        count: h.count,
        min: h.count > 0 ? h.min : 0,
        max: h.count > 0 ? h.max : 0,
        p50: percentile(h.values, 50),
        p95: percentile(h.values, 95),
        p99: percentile(h.values, 99),
      };
    }

    return {
      counters: { ...this.counters },
      histograms: histogramStats,
      gauges: { ...this.gauges },
      timestamp: new Date().toISOString(),
    };
  }

  // Reset all metrics
  reset(): void {
    this.counters = {
      messages_received: 0,
      messages_sent: 0,
      claude_requests: 0,
      claude_responses: 0,
      tool_uses: 0,
      tool_approvals: 0,
      tool_rejections: 0,
      errors: 0,
      rate_limit_hits: 0,
    };

    this.histograms = {
      claude_response_time: createHistogramData(),
      telegram_send_time: createHistogramData(),
      tool_execution_time: createHistogramData(),
      message_processing_time: createHistogramData(),
    };

    this.gauges.active_sessions = 0;
    this.gauges.queue_size = 0;
    this.startTime = Date.now();

    logger.info('Metrics reset');
  }

  // Log current metrics
  logMetrics(): void {
    const snapshot = this.getSnapshot();
    logger.info({ metrics: snapshot }, 'Metrics snapshot');
  }
}

// Singleton instance
export const metrics = new MetricsCollector();

// Convenience functions
export function incrementCounter(counter: keyof CounterMetrics, value: number = 1): void {
  metrics.increment(counter, value);
}

export function recordTiming(histogram: keyof HistogramMetrics, value: number): void {
  metrics.recordHistogram(histogram, value);
}

export function startTiming(histogram: keyof HistogramMetrics): () => number {
  return metrics.startTimer(histogram);
}

export function setGauge(gauge: keyof GaugeMetrics, value: number): void {
  metrics.setGauge(gauge, value);
}

export function incrementGauge(gauge: keyof GaugeMetrics, value: number = 1): void {
  metrics.incrementGauge(gauge, value);
}

export function decrementGauge(gauge: keyof GaugeMetrics, value: number = 1): void {
  metrics.decrementGauge(gauge, value);
}

export function getMetricsSnapshot(): MetricsSnapshot {
  return metrics.getSnapshot();
}

// Periodic metrics logging (optional)
let metricsInterval: NodeJS.Timeout | null = null;

export function startMetricsLogging(intervalMs: number = 60000): void {
  if (metricsInterval) {
    clearInterval(metricsInterval);
  }
  metricsInterval = setInterval(() => {
    metrics.logMetrics();
  }, intervalMs);
  logger.info({ intervalMs }, 'Metrics logging started');
}

export function stopMetricsLogging(): void {
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
    logger.info('Metrics logging stopped');
  }
}

export default metrics;
