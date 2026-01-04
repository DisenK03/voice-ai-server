/**
 * Voice Session - End Handler
 *
 * Handles session cleanup, cost tracking, and post-call processing.
 */

import { SessionLogger, costTracker } from '../utils/index.js';
import { CallerVerification } from '../caller-verification/index.js';
import { SessionRecorder } from '../session-recorder/index.js';
import { ConversationMessage, TenantContext, PropertyContext } from './types.js';
import { createUnverifiedRequest, VerificationData } from './verification.js';
import { sendPostCallMediaRequest, extractIssueCategory, IssueData } from './issue-handler.js';
import { cleanupAudio, AudioComponents } from './audio-handler.js';
import { clearDurationTimers, DurationTimers } from './duration-limits.js';

export interface EndSessionContext {
  log: SessionLogger;
  recorder: SessionRecorder;
  verifier: CallerVerification | null;
  propertyContext: PropertyContext | null;
  tenantContext: TenantContext | null;
  fromPhone: string;
  toPhone: string;
  callStartTime: number;
  audio: AudioComponents | null;
  silenceTimer: NodeJS.Timeout | null;
  durationTimers: DurationTimers;
}

export interface EndSessionData {
  verificationData: VerificationData;
  conversationHistory: ConversationMessage[];
  issueData: IssueData;
  createdWorkOrderId: string | null;
}

/**
 * Handle end of voice session
 */
export async function handleEndSession(
  ctx: EndSessionContext,
  data: EndSessionData
): Promise<void> {
  const callDurationMs = Date.now() - ctx.callStartTime;
  ctx.log.info('Ending voice session', {
    durationMs: callDurationMs,
    verificationState: data.verificationData.state,
  });

  // Create unverified request if caller wasn't verified
  if (
    (data.verificationData.state === 'UNVERIFIED' || data.verificationData.state === 'VERIFYING') &&
    !data.verificationData.createdUnverifiedRequest &&
    ctx.verifier &&
    ctx.propertyContext
  ) {
    await createUnverifiedRequest(
      {
        log: ctx.log,
        verifier: ctx.verifier,
        recorder: ctx.recorder,
        propertyContext: ctx.propertyContext,
        fromPhone: ctx.fromPhone,
      },
      data.verificationData,
      data.conversationHistory
    );
  }

  // Send post-call media request if there was conversation
  if (data.conversationHistory.length > 2) {
    let issueData = data.issueData;
    if (!issueData.category) {
      issueData = extractIssueCategory(data.conversationHistory, ctx.log);
    }
    await sendPostCallMediaRequest(
      {
        log: ctx.log,
        recorder: ctx.recorder,
        fromPhone: ctx.fromPhone,
        toPhone: ctx.toPhone,
        tenantContext: ctx.tenantContext,
      },
      issueData.category
    );
  }

  // End recording
  await ctx.recorder.endRecording({
    tenantId: ctx.tenantContext?.id,
    workOrderId: data.createdWorkOrderId || undefined,
  });

  // Track costs
  costTracker.trackTwilioVoice(ctx.log.sessionId, callDurationMs);
  if (ctx.audio) {
    costTracker.trackElevenLabs(ctx.log.sessionId, ctx.audio.totalTTSCharacters);
    costTracker.trackDeepgram(ctx.log.sessionId, ctx.audio.totalSTTDurationMs);
  }

  // Log summaries
  costTracker.logSessionSummary(ctx.log.sessionId);
  ctx.log.logSummary();

  // Cleanup resources
  if (ctx.audio) cleanupAudio(ctx.audio);
  if (ctx.silenceTimer) clearTimeout(ctx.silenceTimer);
  clearDurationTimers(ctx.durationTimers);
}
