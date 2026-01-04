/**
 * Structured Logger with Correlation IDs
 *
 * Provides consistent logging format with session context.
 * Supports both human-readable and JSON output formats.
 */

import { randomUUID } from 'crypto';
import { SessionLogger, LogContext, LogLevel, LogFormat } from './session-logger.js';

// Re-export types and classes from split modules
export { LogContext, LogLevel, LogFormat } from './session-logger.js';
export { SessionLogger } from './session-logger.js';
export { LatencyMetrics, LatencyStats } from './latency-metrics.js';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  sessionId: string;
  message: string;
  service?: string;
  version?: string;
  channel?: string;
  callSid?: string;
  propertyId?: string;
  tenantId?: string;
  data?: Record<string, unknown>;
  latencyMs?: number;
  error?: {
    name?: string;
    message?: string;
    stack?: string;
  };
}

// Configuration from environment
const SERVICE_NAME = process.env.SERVICE_NAME || 'voice-server';
const SERVICE_VERSION = process.env.npm_package_version || '1.0.0';

// Log level hierarchy for filtering
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Get current log format (checked on each call for test flexibility)
 */
function getLogFormat(): LogFormat {
  return (process.env.LOG_FORMAT as LogFormat) || 'human';
}

/**
 * Check if a log level should be output based on configured level
 */
function shouldLog(level: LogLevel): boolean {
  const configuredLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
  return LOG_LEVELS[level] >= LOG_LEVELS[configuredLevel];
}

/**
 * Format error object for logging
 */
function formatError(error: unknown): LogEntry['error'] | undefined {
  if (!error) return undefined;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

/**
 * Base Logger class with context management
 */
class Logger {
  private context: LogContext | null = null;
  private timers = new Map<string, number>();

  /**
   * Generate a new session ID
   */
  generateSessionId(): string {
    return randomUUID();
  }

  /**
   * Set context for all subsequent logs
   */
  setContext(context: LogContext) {
    this.context = context;
  }

  /**
   * Clear context
   */
  clearContext() {
    this.context = null;
    this.timers.clear();
  }

  /**
   * Start a timer for latency tracking
   */
  startTimer(name: string): void {
    this.timers.set(name, Date.now());
  }

  /**
   * End a timer and return elapsed ms
   */
  endTimer(name: string): number {
    const start = this.timers.get(name);
    this.timers.delete(name);
    return start ? Date.now() - start : 0;
  }

  /**
   * Log with automatic timer ending
   */
  logWithLatency(level: LogLevel, timerName: string, message: string, data?: Record<string, unknown>) {
    const latencyMs = this.endTimer(timerName);
    this.log(level, message, { ...data, latencyMs });
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>) {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      sessionId: this.context?.sessionId || 'no-session',
      message,
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      ...(this.context?.channel && { channel: this.context.channel }),
      ...(this.context?.callSid && { callSid: this.context.callSid }),
      ...(this.context?.propertyId && { propertyId: this.context.propertyId }),
      ...(this.context?.tenantId && { tenantId: this.context.tenantId }),
      ...(data?.latencyMs !== undefined && { latencyMs: data.latencyMs as number }),
    };

    // Handle data and errors separately
    if (data) {
      const { latencyMs, error, ...restData } = data as Record<string, unknown>;
      if (Object.keys(restData).length > 0) {
        entry.data = restData;
      }
      if (error) {
        entry.error = formatError(error);
      }
    }

    // Output based on format
    if (getLogFormat() === 'json') {
      this.outputJson(level, entry);
    } else {
      this.outputHuman(level, entry);
    }

    return entry;
  }

  private outputJson(level: LogLevel, entry: LogEntry) {
    const output = JSON.stringify(entry);
    switch (level) {
      case 'debug':
        console.debug(output);
        break;
      case 'info':
        console.log(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      case 'error':
        console.error(output);
        break;
    }
  }

  private outputHuman(level: LogLevel, entry: LogEntry) {
    const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.sessionId.slice(0, 8)}]`;
    const latencyStr = entry.latencyMs !== undefined ? ` (${entry.latencyMs}ms)` : '';
    const dataStr = entry.data && Object.keys(entry.data).length > 0 ? ` ${JSON.stringify(entry.data)}` : '';
    const errorStr = entry.error ? ` [ERROR: ${entry.error.message}]` : '';

    const fullMessage = `${prefix} ${entry.message}${latencyStr}${dataStr}${errorStr}`;

    switch (level) {
      case 'debug':
        console.debug(fullMessage);
        break;
      case 'info':
        console.log(fullMessage);
        break;
      case 'warn':
        console.warn(fullMessage);
        break;
      case 'error':
        console.error(fullMessage);
        if (entry.error?.stack) {
          console.error(entry.error.stack);
        }
        break;
    }
  }

  debug(message: string, data?: Record<string, unknown>) {
    return this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>) {
    return this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>) {
    return this.log('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>) {
    return this.log('error', message, data);
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext: Partial<LogContext>): SessionLogger {
    return new SessionLogger({
      ...this.context,
      ...additionalContext,
    } as LogContext);
  }
}

// Singleton logger
export const logger = new Logger();

// Factory function for session loggers
export function createSessionLogger(callSid?: string, propertyId?: string): SessionLogger {
  return new SessionLogger({
    sessionId: logger.generateSessionId(),
    callSid,
    propertyId,
  });
}
