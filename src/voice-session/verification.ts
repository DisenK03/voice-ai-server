/**
 * Voice Session - Verification Handler
 *
 * Handles caller verification flow:
 * - Phone lookup
 * - Name/unit matching
 * - Unverified caller handling
 */

import { SessionLogger } from '../utils/index.js';
import { CallerVerification } from '../caller-verification/index.js';
import { SessionRecorder } from '../session-recorder/index.js';
import { VerificationState, TenantContext, PropertyContext } from './types.js';

export interface VerificationContext {
  log: SessionLogger;
  verifier: CallerVerification | null;
  recorder: SessionRecorder;
  propertyContext: PropertyContext | null;
  fromPhone: string;
}

export interface VerificationData {
  state: VerificationState;
  tenantContext: TenantContext | null;
  claimedName: string | null;
  claimedUnit: string | null;
  promptCount: number;
  maxPrompts: number;
  createdUnverifiedRequest: boolean;
}

/**
 * Perform initial verification via phone lookup
 */
export async function performInitialVerification(
  ctx: VerificationContext,
  initialTenantContext: TenantContext | null
): Promise<{ state: VerificationState; tenant: TenantContext | null }> {
  if (!ctx.verifier) {
    return { state: 'UNVERIFIED', tenant: null };
  }

  // Already have tenant from existing lookup
  if (initialTenantContext) {
    ctx.log.info('Caller verified via phone lookup', {
      tenantId: initialTenantContext.id,
      tenantName: initialTenantContext.name,
    });
    return { state: 'VERIFIED', tenant: initialTenantContext };
  }

  // Attempt phone lookup
  const result = await ctx.verifier.lookupByPhone(ctx.fromPhone);

  if (result.verified && result.tenant) {
    ctx.log.info('Caller verified via phone lookup', {
      tenantId: result.tenant.id,
      tenantName: result.tenant.name,
    });
    return { state: 'VERIFIED', tenant: result.tenant as TenantContext };
  }

  // Need to ask for name/unit
  ctx.log.info('Caller not found, entering verification flow');
  return { state: 'VERIFYING', tenant: null };
}

/**
 * Handle a verification attempt from user input
 */
export async function handleVerificationAttempt(
  ctx: VerificationContext,
  text: string,
  data: VerificationData
): Promise<VerificationData> {
  if (!ctx.verifier) return data;

  // Try to parse name and unit from what they said
  const claimed = ctx.verifier.parseClaimedIdentity(text);

  // Update stored claimed identity
  const hadName = !!data.claimedName;
  const hadUnit = !!data.claimedUnit;

  const newData = { ...data };

  if (claimed.name) newData.claimedName = claimed.name;
  if (claimed.unit) newData.claimedUnit = claimed.unit;

  // Only count as verification attempt if we got NEW info
  const gotNewInfo = (!hadName && claimed.name) || (!hadUnit && claimed.unit);
  if (gotNewInfo) {
    newData.promptCount++;
    ctx.log.info('Verification attempt', {
      promptCount: newData.promptCount,
      maxPrompts: newData.maxPrompts,
      claimedName: newData.claimedName,
      claimedUnit: newData.claimedUnit,
    });
  }

  // If we have both name and unit, try to match
  if (newData.claimedName && newData.claimedUnit) {
    const result = await ctx.verifier.attemptMatch(newData.claimedName, newData.claimedUnit);

    if (result.verified && result.tenant) {
      newData.tenantContext = result.tenant as TenantContext;
      newData.state = 'VERIFIED';
      ctx.log.info('Caller verified via name/unit match', {
        tenantId: result.tenant.id,
        attempts: result.attempts,
      });

      // Link recording to tenant
      if (ctx.propertyContext) {
        await ctx.recorder.linkToTenant(
          result.tenant.id,
          ctx.propertyContext.user_id
        );
      }
      return newData;
    } else {
      // We have both name/unit but no match - mark as unverified
      newData.state = 'UNVERIFIED';
      ctx.log.info('Name/unit provided but no match found, marking as unverified', {
        claimedName: newData.claimedName,
        claimedUnit: newData.claimedUnit,
      });
      return newData;
    }
  }

  // Check if we've reached max prompts
  if (newData.promptCount >= newData.maxPrompts) {
    newData.state = 'UNVERIFIED';
    ctx.log.info('Max verification prompts reached, marking as unverified', {
      promptCount: newData.promptCount,
      claimedName: newData.claimedName,
      claimedUnit: newData.claimedUnit,
    });
  }

  return newData;
}

/**
 * Create an unverified request for PM review
 */
export async function createUnverifiedRequest(
  ctx: VerificationContext,
  data: VerificationData,
  conversationHistory: Array<{ role: string; content: string }>
): Promise<string | null> {
  if (!ctx.verifier || !ctx.propertyContext) {
    ctx.log.warn('Cannot create unverified request - missing context');
    return null;
  }

  if (data.createdUnverifiedRequest) {
    ctx.log.info('Unverified request already created, skipping');
    return null;
  }

  ctx.log.startTimer('create_unverified');

  const userMessages = conversationHistory
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' ');

  // Generate AI summary
  const summary = await ctx.recorder.generateSummary();

  const requestId = await ctx.verifier.createUnverifiedRequest({
    userId: ctx.propertyContext.user_id,
    phoneNumber: ctx.fromPhone,
    claimedName: data.claimedName,
    claimedUnit: data.claimedUnit,
    issueDescription: userMessages,
    transcript: ctx.recorder.getFullTranscript(),
    aiSummary: summary,
    callRecordId: ctx.recorder.getCallRecordId(),
  });

  ctx.log.infoWithLatency('create_unverified', 'Unverified request created', {
    requestId,
  });

  return requestId;
}
