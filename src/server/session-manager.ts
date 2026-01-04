/**
 * Session Manager
 *
 * Handles graceful shutdown and orphaned session cleanup.
 */

import { FastifyInstance } from 'fastify';
import { VoiceSession } from '../voice-session.js';
import { OutboundVoiceSession } from '../outbound-session/index.js';

export type ActiveSession = VoiceSession | OutboundVoiceSession;

// Track active sessions for clean shutdown
export const activeSessions = new Set<ActiveSession>();

// Track session start times for orphan detection
export const sessionStartTimes = new Map<ActiveSession, number>();

let isShuttingDown = false;

const SHUTDOWN_TIMEOUT_MS = 30000; // Max 30 seconds to wait for sessions
const SESSION_MAX_DURATION_MS = 60 * 60 * 1000; // 1 hour max per session
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes

/**
 * Graceful shutdown handler.
 * Waits for active sessions to complete before exiting.
 */
export async function gracefulShutdown(signal: string, fastify: FastifyInstance): Promise<void> {
  if (isShuttingDown) {
    console.log('Shutdown already in progress...');
    return;
  }
  isShuttingDown = true;

  console.log(`\n[Shutdown] Received ${signal}, starting graceful shutdown...`);
  console.log(`[Shutdown] Active sessions: ${activeSessions.size}`);

  // Close the Fastify server to stop accepting new connections
  try {
    await fastify.close();
    console.log('[Shutdown] Server closed - no new connections accepted');
  } catch (err) {
    console.error('[Shutdown] Error closing server:', err);
  }

  // Wait for active sessions to complete (with timeout)
  if (activeSessions.size > 0) {
    const startTime = Date.now();

    while (activeSessions.size > 0) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= SHUTDOWN_TIMEOUT_MS) {
        console.warn(
          `[Shutdown] Timeout after ${SHUTDOWN_TIMEOUT_MS}ms - force closing ${activeSessions.size} sessions`
        );

        // Force end remaining sessions
        for (const session of activeSessions) {
          try {
            await session.end();
          } catch (err) {
            console.error('[Shutdown] Error force-closing session:', err);
          }
        }
        break;
      }

      console.log(
        `[Shutdown] Waiting for ${activeSessions.size} sessions... (${Math.ceil((SHUTDOWN_TIMEOUT_MS - elapsed) / 1000)}s remaining)`
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.log('[Shutdown] Graceful shutdown complete');
  process.exit(0);
}

/**
 * Clean up sessions that have been running too long
 */
function cleanupOrphanedSessions(): void {
  if (isShuttingDown) return;

  const now = Date.now();
  let cleanedCount = 0;

  for (const session of activeSessions) {
    const startTime = sessionStartTimes.get(session);
    if (startTime && now - startTime > SESSION_MAX_DURATION_MS) {
      console.warn(
        `[Cleanup] Session ${session.sessionId.slice(0, 8)} exceeded max duration (${Math.round((now - startTime) / 1000 / 60)}min), ending...`
      );
      session.end().catch((err) => {
        console.error('[Cleanup] Error ending orphaned session:', err);
      });
      activeSessions.delete(session);
      sessionStartTimes.delete(session);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    console.log(`[Cleanup] Cleaned up ${cleanedCount} orphaned session(s)`);
  }
}

/**
 * Start periodic cleanup of orphaned sessions
 */
export function startSessionCleanup(): void {
  const cleanupInterval = setInterval(cleanupOrphanedSessions, CLEANUP_INTERVAL_MS);
  // Ensure cleanup interval doesn't prevent process exit
  cleanupInterval.unref();
}

/**
 * Track a new session
 */
export function trackSession(session: ActiveSession): void {
  activeSessions.add(session);
  sessionStartTimes.set(session, Date.now());
}

/**
 * Untrack a session
 */
export function untrackSession(session: ActiveSession): void {
  activeSessions.delete(session);
  sessionStartTimes.delete(session);
}
