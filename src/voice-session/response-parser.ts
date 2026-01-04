/**
 * Voice Session - Response Parser
 *
 * Parses LLM responses for control tags and cleans output for display.
 */

import { SessionLogger } from '../utils/index.js';
import { SessionRecorder } from '../session-recorder/index.js';
import { CallerVerification } from '../caller-verification/index.js';
import { ConversationMessage, VerificationState, PropertyContext, TenantContext } from './types.js';
import { createUnverifiedRequest, VerificationData } from './verification.js';
import { extractIssueCategory, IssueData } from './issue-handler.js';
import { createTicketFromConversation } from './ticket-handler.js';

export interface ParseContext {
  log: SessionLogger;
  recorder: SessionRecorder;
  verifier: CallerVerification | null;
  propertyContext: PropertyContext | null;
  tenantContext: TenantContext | null;
  fromPhone: string;
}

export interface ParseResult {
  shouldCreateTicket: boolean;
  shouldEndCall: boolean;
  createdUnverifiedRequest: boolean;
  issueData: IssueData;
}

/**
 * Parse LLM response for control tags
 */
export async function parseResponse(
  ctx: ParseContext,
  response: string,
  verificationData: VerificationData,
  conversationHistory: ConversationMessage[],
  currentIssueData: IssueData
): Promise<ParseResult> {
  const result: ParseResult = {
    shouldCreateTicket: false,
    shouldEndCall: false,
    createdUnverifiedRequest: verificationData.createdUnverifiedRequest,
    issueData: currentIssueData,
  };

  // Check for ticket creation tag (verified callers only)
  if (response.includes('[CREATE_TICKET]') && verificationData.state === 'VERIFIED') {
    result.shouldCreateTicket = true;
  }

  // Check for unverified request creation
  if (response.includes('[CREATE_UNVERIFIED]') && verificationData.state === 'UNVERIFIED') {
    await createUnverifiedRequest(
      {
        log: ctx.log,
        verifier: ctx.verifier,
        recorder: ctx.recorder,
        propertyContext: ctx.propertyContext,
        fromPhone: ctx.fromPhone,
      },
      verificationData,
      conversationHistory
    );
    result.createdUnverifiedRequest = true;
  }

  // Check for end call tag
  if (response.includes('[END_CALL]')) {
    result.shouldEndCall = true;
  }

  // Extract issue category if not already set
  if (!currentIssueData.category && conversationHistory.length > 1) {
    result.issueData = extractIssueCategory(conversationHistory, ctx.log);
  }

  return result;
}

/**
 * Create work order from conversation if needed
 */
export async function handleTicketCreation(
  ctx: ParseContext,
  conversationHistory: ConversationMessage[]
): Promise<string | null> {
  return createTicketFromConversation(
    {
      log: ctx.log,
      recorder: ctx.recorder,
      propertyContext: ctx.propertyContext,
      tenantContext: ctx.tenantContext,
    },
    conversationHistory
  );
}

/**
 * Remove control tags from response for display/TTS
 */
export function cleanResponse(response: string): string {
  return response
    .replace(/\[CREATE_TICKET\]/g, '')
    .replace(/\[CREATE_UNVERIFIED\]/g, '')
    .replace(/\[END_CALL\]/g, '')
    .replace(/\[TENANT:[^\]]+\]/g, '')
    .replace(/\[VERIFIED\]/g, '')
    .trim();
}
