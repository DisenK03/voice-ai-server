/**
 * Voice Session - Duration Limits
 *
 * Handles call duration timers and limits.
 */

import { SessionLogger } from '../utils/index.js';
import { SessionRecorder } from '../session-recorder/index.js';
import { SOFT_LIMIT_MS, HARD_LIMIT_MS } from './types.js';

export interface DurationContext {
  log: SessionLogger;
  recorder: SessionRecorder;
  callStartTime: number;
  speak: (text: string) => Promise<void>;
  addToConversationHistory: (role: 'user' | 'assistant', content: string) => void;
  end: () => void;
}

export interface DurationTimers {
  softLimitTimer: NodeJS.Timeout | null;
  hardLimitTimer: NodeJS.Timeout | null;
  hasHitSoftLimit: boolean;
}

/**
 * Handle soft limit reached (suggest SMS)
 */
async function handleSoftLimit(
  ctx: DurationContext,
  timers: DurationTimers
): Promise<void> {
  if (timers.hasHitSoftLimit) return;
  timers.hasHitSoftLimit = true;

  const durationMin = Math.round((Date.now() - ctx.callStartTime) / 60000);
  ctx.log.info('Soft call limit reached', { durationMin });

  // Gently suggest switching to text
  const message = `Hey, I just want to make sure I'm helping you as best I can. We've been chatting for a bit - if you'd prefer, you can also text this number anytime and I can help you that way too. It's totally up to you - I'm happy to keep talking or you can reach out via text whenever it's convenient. Is there anything else you need help with right now?`;

  await ctx.speak(message);
  ctx.addToConversationHistory('assistant', message);
  ctx.recorder.appendTranscript('ai', message);
}

/**
 * Handle hard limit reached (end call)
 */
async function handleHardLimit(ctx: DurationContext): Promise<void> {
  const durationMin = Math.round((Date.now() - ctx.callStartTime) / 60000);
  ctx.log.info('Hard call limit reached, ending call', { durationMin });

  // Politely wrap up the call
  const message = `I've really enjoyed helping you today. I want to make sure the property manager can review everything we discussed. I'm going to wrap up our call now, but remember you can always text this number if you think of anything else. Take care!`;

  await ctx.speak(message);
  ctx.addToConversationHistory('assistant', message);
  ctx.recorder.appendTranscript('ai', message);

  // End the call after the message plays
  setTimeout(() => ctx.end(), 8000);
}

/**
 * Start call duration timers
 */
export function startDurationTimers(
  ctx: DurationContext,
  timers: DurationTimers
): void {
  // Soft limit: At 20 minutes, gently suggest continuing via text
  timers.softLimitTimer = setTimeout(() => {
    handleSoftLimit(ctx, timers);
  }, SOFT_LIMIT_MS);

  // Hard limit: At 30 minutes, politely end the call
  timers.hardLimitTimer = setTimeout(() => {
    handleHardLimit(ctx);
  }, HARD_LIMIT_MS);

  ctx.log.info('Call duration timers started', {
    softLimitMin: SOFT_LIMIT_MS / 60000,
    hardLimitMin: HARD_LIMIT_MS / 60000,
  });
}

/**
 * Clear all duration timers
 */
export function clearDurationTimers(timers: DurationTimers): void {
  if (timers.softLimitTimer) {
    clearTimeout(timers.softLimitTimer);
    timers.softLimitTimer = null;
  }
  if (timers.hardLimitTimer) {
    clearTimeout(timers.hardLimitTimer);
    timers.hardLimitTimer = null;
  }
}
