/**
 * Caller Verification Types
 *
 * Shared types for caller verification modules.
 */

import { TenantContext, PropertyContext } from '../voice-session/types.js';

// Re-export for convenience
export type { TenantContext, PropertyContext } from '../voice-session/types.js';

// Extended property context with address (returned from property lookups)
export interface PropertyContextWithAddress extends PropertyContext {
  address?: string;
}

export interface VerificationResult {
  verified: boolean;
  tenant: TenantContext | null;
  property: PropertyContextWithAddress | null;
  attempts: number;
  verificationMethod: 'phone_lookup' | 'name_unit_match' | 'unverified';
}

export interface ClaimedIdentity {
  name: string | null;
  unit: string | null;
}

export interface UnverifiedRequestData {
  userId: string;
  phoneNumber: string;
  claimedName: string | null;
  claimedUnit: string | null;
  issueDescription: string | null;
  transcript: string | null;
  aiSummary: string | null;
  callRecordId: string | null;
}
