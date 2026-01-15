import pino, { Logger, LoggerOptions } from 'pino';

export interface LogContext {
  chatId?: number;
  userId?: number;
  sessionId?: string;
  tool?: string;
  requestId?: string;
  [key: string]: unknown;
}

export interface StructuredLogger extends Logger {
  withContext(ctx: LogContext): Logger;
}

function createLoggerOptions(): LoggerOptions {
  const isDev = process.env.NODE_ENV !== 'production';
  const level = process.env.LOG_LEVEL || (isDev ? 'debug' : 'info');

  const options: LoggerOptions = {
    level,
    base: {
      pid: process.pid,
      service: 'chatcode-bot',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  // Pretty print in development
  if (isDev) {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname,service',
        messageFormat: '{msg}',
      },
    };
  }

  return options;
}

function createLogger(): StructuredLogger {
  const baseLogger = pino(createLoggerOptions());

  // Extend with context binding helper
  const structuredLogger = baseLogger as StructuredLogger;

  structuredLogger.withContext = function (ctx: LogContext): Logger {
    return this.child({ ctx });
  };

  return structuredLogger;
}

// Main logger instance
export const logger = createLogger();

// Convenience methods with context
export function logInfo(msg: string, ctx?: LogContext, data?: Record<string, unknown>): void {
  if (ctx || data) {
    logger.info({ ctx, ...data }, msg);
  } else {
    logger.info(msg);
  }
}

export function logError(
  msg: string,
  error?: Error | unknown,
  ctx?: LogContext,
  data?: Record<string, unknown>
): void {
  const err = error instanceof Error ? error : error ? new Error(String(error)) : undefined;
  logger.error({ err, ctx, ...data }, msg);
}

export function logWarn(msg: string, ctx?: LogContext, data?: Record<string, unknown>): void {
  if (ctx || data) {
    logger.warn({ ctx, ...data }, msg);
  } else {
    logger.warn(msg);
  }
}

export function logDebug(msg: string, ctx?: LogContext, data?: Record<string, unknown>): void {
  if (ctx || data) {
    logger.debug({ ctx, ...data }, msg);
  } else {
    logger.debug(msg);
  }
}

// Performance timing helper
export function startTimer(): () => number {
  const start = process.hrtime.bigint();
  return () => {
    const end = process.hrtime.bigint();
    return Number(end - start) / 1_000_000; // Convert to milliseconds
  };
}

// Log operation with timing
export async function logOperation<T>(
  operation: string,
  fn: () => Promise<T>,
  ctx?: LogContext
): Promise<T> {
  const getElapsed = startTimer();

  try {
    const result = await fn();
    const elapsed = getElapsed();
    logger.info({ ctx, elapsed, success: true }, `${operation} completed`);
    return result;
  } catch (error) {
    const elapsed = getElapsed();
    logger.error(
      { err: error instanceof Error ? error : new Error(String(error)), ctx, elapsed },
      `${operation} failed`
    );
    throw error;
  }
}

// Export default logger for general use
export default logger;
