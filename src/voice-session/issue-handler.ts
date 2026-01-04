/**
 * Voice Session - Issue Handler
 *
 * Handles issue extraction and post-call media requests.
 */

import { SessionLogger } from '../utils/index.js';
import { SessionRecorder } from '../session-recorder/index.js';
import { sendSMS } from '../sms-session.js';
import {
  TenantContext,
  ISSUE_CATEGORIES,
  MEDIA_HELPFUL_CATEGORIES,
  ConversationMessage,
} from './types.js';

export interface IssueContext {
  log: SessionLogger;
  recorder: SessionRecorder;
  fromPhone: string;
  toPhone: string;
  tenantContext: TenantContext | null;
}

export interface IssueData {
  category: string | null;
  description: string | null;
}

/**
 * Extract issue category from conversation for determining if media would help
 */
export function extractIssueCategory(
  conversationHistory: ConversationMessage[],
  log: SessionLogger
): IssueData {
  const userMessages = conversationHistory
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' ')
    .toLowerCase();

  // Save full description for SMS
  const description = conversationHistory
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' ');

  // Categorize based on keywords
  for (const [category, pattern] of Object.entries(ISSUE_CATEGORIES)) {
    if (pattern.test(userMessages)) {
      log.info('Issue category detected', { category });
      return { category, description };
    }
  }

  return { category: 'other', description };
}

/**
 * Determine if requesting media would help diagnose the issue
 */
export function shouldRequestMedia(issueCategory: string | null): boolean {
  if (!issueCategory) return false;
  return MEDIA_HELPFUL_CATEGORIES.includes(issueCategory);
}

/**
 * Build the media request message based on issue type
 */
function buildMediaRequestMessage(
  issueCategory: string,
  tenantName: string | null
): string {
  const greeting = tenantName ? `Hi ${tenantName}!` : 'Hi!';
  let mediaRequest = `${greeting} Thanks for calling! `;

  switch (issueCategory) {
    case 'plumbing_leak':
      mediaRequest += "If you can safely take a photo or quick video of the leak, it'll help us send the right person with the right tools. Just reply to this text with the photo when you can!";
      break;
    case 'structural':
      mediaRequest += "A photo of the issue would really help us assess it better. Just reply to this text with a picture when you have a moment!";
      break;
    case 'appliance':
      mediaRequest += "If you can snap a photo of the appliance (and any error codes if there are any), it'll help us figure out exactly what's going on. Just reply with the pic!";
      break;
    case 'pest':
      mediaRequest += "If you're able to safely get a photo (no need to get too close!), it'll help us identify exactly what we're dealing with. Just reply with the pic!";
      break;
    case 'electrical':
      mediaRequest += "If it's safe to do so, a photo of the outlet/switch would help us assess the issue. Just reply with the pic when you can!";
      break;
    default:
      mediaRequest += "If you can send us a photo of the issue, it'll really help us get this sorted faster. Just reply to this text with the pic!";
  }

  return mediaRequest;
}

/**
 * Send post-call SMS requesting photos if it would help diagnose the issue
 */
export async function sendPostCallMediaRequest(
  ctx: IssueContext,
  issueCategory: string | null
): Promise<boolean> {
  if (!shouldRequestMedia(issueCategory)) {
    ctx.log.info('Skipping media request - not helpful for this issue type', {
      category: issueCategory,
    });
    return false;
  }

  // Need the tenant's phone and property's Twilio number
  if (!ctx.fromPhone || !ctx.toPhone) {
    ctx.log.warn('Cannot send media request - missing phone numbers');
    return false;
  }

  const tenantName = ctx.tenantContext?.name?.split(' ')[0] || null;
  const mediaRequest = buildMediaRequestMessage(issueCategory!, tenantName);

  try {
    const success = await sendSMS(ctx.fromPhone, ctx.toPhone, mediaRequest);

    if (success) {
      ctx.log.info('Post-call media request sent', {
        category: issueCategory,
        tenantPhone: ctx.fromPhone,
      });

      // Record this in the session recorder
      ctx.recorder.appendTranscript('ai', `[POST-CALL SMS] ${mediaRequest}`);
      return true;
    } else {
      ctx.log.error('Failed to send post-call media request SMS');
      return false;
    }
  } catch (error) {
    ctx.log.error('Error sending post-call media request', {
      error: (error as Error).message,
    });
    return false;
  }
}
