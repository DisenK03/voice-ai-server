/**
 * Prometheus Metrics Tracking Functions
 *
 * Convenience functions for tracking common voice server metrics.
 */

import { metrics } from './metrics-registry.js';

// Register standard voice server metrics
metrics.register({
  name: 'voice_sessions_total',
  help: 'Total number of voice sessions',
  type: 'counter',
  labels: ['direction', 'status'],
});

metrics.register({
  name: 'voice_sessions_active',
  help: 'Number of currently active voice sessions',
  type: 'gauge',
});

metrics.register({
  name: 'sms_sessions_total',
  help: 'Total number of SMS sessions',
  type: 'counter',
  labels: ['status'],
});

metrics.register({
  name: 'call_duration_seconds',
  help: 'Call duration in seconds',
  type: 'histogram',
}, [10, 30, 60, 120, 300, 600, 1200, 1800]);

metrics.register({
  name: 'api_request_duration_ms',
  help: 'API request duration in milliseconds',
  type: 'histogram',
  labels: ['service', 'operation'],
});

metrics.register({
  name: 'api_requests_total',
  help: 'Total API requests by service',
  type: 'counter',
  labels: ['service', 'status'],
});

metrics.register({
  name: 'api_errors_total',
  help: 'Total API errors by service',
  type: 'counter',
  labels: ['service', 'error_type'],
});

metrics.register({
  name: 'circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
  type: 'gauge',
  labels: ['service'],
});

metrics.register({
  name: 'cost_usd_total',
  help: 'Total cost in USD by service',
  type: 'counter',
  labels: ['service'],
});

metrics.register({
  name: 'transcript_characters_total',
  help: 'Total characters processed for TTS/STT',
  type: 'counter',
  labels: ['service', 'direction'],
});

// Convenience functions for common operations

export function trackVoiceSession(direction: 'inbound' | 'outbound', status: 'started' | 'completed' | 'error'): void {
  metrics.incCounter('voice_sessions_total', { direction, status });
}

export function trackActiveSession(delta: number): void {
  if (delta > 0) {
    metrics.incGauge('voice_sessions_active', {}, delta);
  } else {
    metrics.decGauge('voice_sessions_active', {}, Math.abs(delta));
  }
}

export function trackSmsSession(status: 'completed' | 'error' | 'rate_limited'): void {
  metrics.incCounter('sms_sessions_total', { status });
}

export function trackCallDuration(durationSeconds: number): void {
  metrics.observeHistogram('call_duration_seconds', durationSeconds);
}

export function trackApiLatency(service: string, operation: string, durationMs: number): void {
  metrics.observeHistogram('api_request_duration_ms', durationMs, { service, operation });
}

export function trackApiRequest(service: string, status: 'success' | 'error'): void {
  metrics.incCounter('api_requests_total', { service, status });
}

export function trackApiError(service: string, errorType: string): void {
  metrics.incCounter('api_errors_total', { service, error_type: errorType });
}

export function trackCircuitBreakerState(service: string, state: 'closed' | 'open' | 'half_open'): void {
  const stateValue = state === 'closed' ? 0 : state === 'open' ? 1 : 2;
  metrics.setGauge('circuit_breaker_state', stateValue, { service });
}

export function trackCost(service: string, costUsd: number): void {
  metrics.incCounter('cost_usd_total', { service }, costUsd);
}

export function trackTranscriptCharacters(service: string, direction: 'input' | 'output', count: number): void {
  metrics.incCounter('transcript_characters_total', { service, direction }, count);
}

/**
 * Get metrics in Prometheus format
 */
export function getMetrics(): string {
  return metrics.export();
}
