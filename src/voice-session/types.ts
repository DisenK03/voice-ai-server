/**
 * Voice Session Types
 *
 * Shared types and interfaces for voice session modules.
 */

import { WebSocket } from 'ws';

// Verification states
export type VerificationState = 'PENDING' | 'VERIFIED' | 'VERIFYING' | 'UNVERIFIED';

// Memory limits to prevent unbounded growth during long calls
export const MAX_CONVERSATION_MESSAGES = 100;

// Call duration limits (in milliseconds)
export const SOFT_LIMIT_MS = 20 * 60 * 1000; // 20 minutes - suggest SMS
export const HARD_LIMIT_MS = 30 * 60 * 1000; // 30 minutes - end call

export interface VoiceSessionConfig {
  socket: WebSocket;
  streamSid: string;
  callSid: string;
  fromPhone: string;
  toPhone: string;
  propertyContext: PropertyContext | null;
  tenantContext: TenantContext | null;
}

export interface PropertyContext {
  id: string;
  name: string;
  user_id: string;
}

export interface TenantContext {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  unit_id?: string;
  is_active?: boolean;
  unit?: {
    id: string;
    unit_number: string;
    property_id?: string;
  };
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Issue categories for determining if media would help
export const ISSUE_CATEGORIES: Record<string, RegExp> = {
  plumbing_leak: /leak|water|drip|flood|burst|pipe|faucet|toilet overflow/i,
  plumbing_other: /toilet|drain|clog|sink|shower|tub|disposal/i,
  hvac: /heat|ac|air condition|thermostat|furnace|cold|hot air|vent|filter/i,
  electrical: /outlet|light|power|switch|breaker|spark|electrical|socket/i,
  appliance: /refrigerator|fridge|dishwasher|washer|dryer|stove|oven|microwave/i,
  structural: /door|window|lock|wall|ceiling|floor|roof|crack|hole/i,
  pest: /bug|roach|ant|mouse|rat|pest|rodent|insect|spider/i,
};

// Categories where photos/videos are especially helpful
export const MEDIA_HELPFUL_CATEGORIES = [
  'plumbing_leak',
  'structural',
  'appliance',
  'pest',
  'electrical',
];
