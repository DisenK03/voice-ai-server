/**
 * Voice Session - Prompt Builder
 *
 * Builds system prompts and greetings based on caller context.
 * All user data is sanitized before inclusion to prevent prompt injection.
 *
 * CUSTOMIZATION:
 * - Set AI_NAME environment variable for your AI's name
 * - Set COMPANY_NAME environment variable for your company name
 * - Modify buildSystemPrompt() to fit your specific use case
 */

import { VerificationState, TenantContext, PropertyContext } from './types.js';
import { sanitizeForPrompt, sanitizeName, sanitizeUnit } from '../utils/prompt-sanitizer.js';

// Customizable via environment variables
const AI_NAME = process.env.AI_NAME || 'your AI assistant';
const COMPANY_NAME = process.env.COMPANY_NAME || 'our company';

export interface PromptContext {
  propertyContext: PropertyContext | null;
  tenantContext: TenantContext | null;
  verificationState: VerificationState;
  claimedName: string | null;
  claimedUnit: string | null;
}

/**
 * Build the initial greeting based on caller context
 * Customize this for your use case
 */
export function buildGreeting(ctx: PromptContext): string {
  // Sanitize all user-provided data to prevent prompt injection
  const companyName = sanitizeForPrompt(ctx.propertyContext?.name, 50) || COMPANY_NAME;

  if (ctx.verificationState === 'VERIFIED' && ctx.tenantContext) {
    const firstName = sanitizeName(ctx.tenantContext.name?.split(' ')[0]) || '';
    // Direct, friendly greeting for known callers
    return `Hey ${firstName}, this is ${AI_NAME} from ${companyName}. How can I help you today?`;
  }

  // Friendly greeting for unknown callers
  return `Hi, this is ${AI_NAME} from ${companyName}. Who am I speaking with?`;
}

/**
 * Build the system prompt for AI responses
 *
 * CUSTOMIZE THIS FOR YOUR USE CASE:
 * - Customer support: Focus on issue resolution, escalation paths
 * - Appointment scheduling: Focus on availability, confirmation
 * - Order status: Focus on tracking info, delivery updates
 * - Technical support: Focus on troubleshooting, ticket creation
 */
export function buildSystemPrompt(ctx: PromptContext): string {
  // Sanitize all user-provided data to prevent prompt injection
  const companyName = sanitizeForPrompt(ctx.propertyContext?.name, 50) || COMPANY_NAME;
  const callerName = sanitizeName(ctx.tenantContext?.name);
  const accountId = sanitizeUnit(ctx.tenantContext?.unit?.unit_number);
  const claimedName = sanitizeName(ctx.claimedName);
  const claimedId = sanitizeUnit(ctx.claimedUnit);

  // Build context based on verification state
  let callerInfo: string;
  let verificationInstructions: string;

  switch (ctx.verificationState) {
    case 'VERIFIED':
      callerInfo = `The caller is ${callerName || 'unknown'}${accountId ? ` (Account: ${accountId})` : ''}. Phone verified.`;
      verificationInstructions = `
VERIFICATION: Complete - proceed with their request.`;
      break;

    case 'VERIFYING':
      callerInfo = claimedName
        ? `Caller says their name is "${claimedName}"${claimedId ? ` (Account: ${claimedId})` : ''}.`
        : "Caller's phone is not in our system.";
      verificationInstructions = `
VERIFICATION: Need caller info
${!claimedName ? '- Ask for their name (you have NOT asked yet)' : '- You already have their name: ' + claimedName}
${!claimedId ? '- Ask for their account/reference number if applicable' : '- You already have their account: ' + claimedId}
- NEVER ask for info you already have
- Once you have their info, proceed to help them`;
      break;

    case 'UNVERIFIED':
      callerInfo = `Caller: ${claimedName || 'unknown name'}${claimedId ? ` (Account: ${claimedId})` : ''}. (Not in system - that's OK)`;
      verificationInstructions = `
VERIFICATION: Complete (unverified caller - that's fine)
- Do NOT ask for name again - you already have it
- Focus on their request now
- Be helpful and collect their information
- Let them know someone will follow up`;
      break;

    default:
      callerInfo = "Caller's identity unknown.";
      verificationInstructions = '';
  }

  return `You are ${AI_NAME}, a helpful assistant for ${companyName}.

COMPANY: ${companyName}
CALLER: ${callerInfo}
${verificationInstructions}

PERSONALITY:
- Friendly and professional - like a helpful office assistant
- Get to the point but be polite
- Brief acknowledgments: "Got it", "Okay", "Sure thing"
- Don't be overly emotional or apologetic

YOUR JOB:
1. Greet the caller warmly
2. If you don't have their name, ask for it once
3. Understand what they need help with
4. Collect any relevant details
5. Confirm and let them know next steps
6. For emergencies, direct them to call 911 immediately

RULES:
- NEVER repeat a question you already asked
- Keep responses SHORT - one or two sentences max
- Don't over-explain or add unnecessary words
- Move the conversation forward efficiently
- Be helpful, not chatty

RESPONSE EXAMPLES:
- "Got it. Can I get your name?"
- "Okay, what can I help you with?"
- "Alright, I'll make sure someone takes care of that. Anything else?"
- "No problem, we'll get that handled for you."

SPECIAL TAGS (caller won't hear):
- [CREATE_TICKET] when you have enough info to create a request
- [CREATE_UNVERIFIED] when caller is unverified but you have their details
- [END_CALL] when conversation is complete
- [TENANT:name|id] when caller identifies themselves`;
}
