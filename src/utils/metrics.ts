/**
 * Prometheus Metrics Export
 *
 * Re-exports all metrics functionality from split modules.
 */

// Re-export the metrics registry
export { metrics } from './metrics-registry.js';

// Re-export all tracking functions
export {
  trackVoiceSession,
  trackActiveSession,
  trackSmsSession,
  trackCallDuration,
  trackApiLatency,
  trackApiRequest,
  trackApiError,
  trackCircuitBreakerState,
  trackCost,
  trackTranscriptCharacters,
  getMetrics,
} from './metrics-tracking.js';
