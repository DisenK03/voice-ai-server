/**
 * Session-scoped Logger
 *
 * Provides logging with fixed session context and latency tracking.
 */

import { LatencyMetrics } from './latency-metrics.js';

export interface LogContext {
  sessionId: string;
  callSid?: string;
  propertyId?: string;
  tenantId?: string;
  channel?: 'voice' | 'sms';
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'human' | 'json';

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
 * Session-scoped logger with fixed context
 */
export class SessionLogger {
  private context: LogContext;
  private timers = new Map<string, number>();
  private metrics: LatencyMetrics;

  constructor(context: LogContext) {
    this.context = context;
    this.metrics = new LatencyMetrics(context.sessionId);
  }

  get sessionId(): string {
    return this.context.sessionId;
  }

  get latencyMetrics(): LatencyMetrics {
    return this.metrics;
  }

  startTimer(name: string): void {
    this.timers.set(name, Date.now());
  }

  endTimer(name: string): number {
    const start = this.timers.get(name);
    this.timers.delete(name);
    const elapsed = start ? Date.now() - start : 0;

    // Record in metrics
    this.metrics.record(name, elapsed);

    return elapsed;
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>) {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      sessionId: this.context.sessionId,
      message,
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      ...(this.context.channel && { channel: this.context.channel }),
      ...(this.context.callSid && { callSid: this.context.callSid }),
      ...(this.context.propertyId && { propertyId: this.context.propertyId }),
      ...(this.context.tenantId && { tenantId: this.context.tenantId }),
    };

    // Handle data and errors
    if (data) {
      const { latencyMs, error, ...restData } = data;
      if (latencyMs !== undefined) {
        entry.latencyMs = typeof latencyMs === 'number' ? latencyMs : parseInt(String(latencyMs), 10);
      }
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
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>) {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>) {
    this.log('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>) {
    this.log('error', message, data);
  }

  /**
   * Log with latency from timer
   */
  infoWithLatency(timerName: string, message: string, data?: Record<string, unknown>) {
    const latencyMs = this.endTimer(timerName);
    this.log('info', message, { ...data, latencyMs });
  }

  /**
   * Log session summary at end
   */
  logSummary() {
    this.metrics.logSummary();
  }
}
