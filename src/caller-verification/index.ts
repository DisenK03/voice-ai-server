/**
 * Caller Verification
 *
 * Handles phone lookup and identity verification for incoming calls.
 * Implements 3-attempt verification flow before marking as unverified.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import {
  VerificationResult,
  ClaimedIdentity,
  UnverifiedRequestData,
  TenantContext,
  PropertyContext,
  PropertyContextWithAddress,
} from './types.js';
import {
  normalizePhone,
  normalizeUnit,
  fuzzyNameMatch,
  capitalizeName,
  parseClaimedIdentity as parseIdentity,
} from './fuzzy-match.js';

config();

// Re-export types for consumers
export type {
  VerificationResult,
  ClaimedIdentity,
  UnverifiedRequestData,
  TenantContext,
  PropertyContext,
  PropertyContextWithAddress,
} from './types.js';

// Re-export utilities
export { normalizePhone, fuzzyNameMatch, parseClaimedIdentity } from './fuzzy-match.js';

let supabase: SupabaseClient;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );
  }
  return supabase;
}

/**
 * Caller verification handler for a specific property
 */
export class CallerVerification {
  private propertyId: string;
  private attempts: number = 0;
  private maxAttempts: number = 3;

  constructor(propertyId: string) {
    this.propertyId = propertyId;
  }

  /**
   * Look up tenant by phone number for a property
   */
  async lookupByPhone(fromPhone: string): Promise<VerificationResult> {
    const normalizedPhone = normalizePhone(fromPhone);

    const { data: tenant } = await getSupabase()
      .from('tenants')
      .select(`
        id,
        name,
        phone,
        email,
        unit_id,
        unit:units(id, unit_number, property_id)
      `)
      .eq('phone', normalizedPhone)
      .eq('is_active', true)
      .maybeSingle();

    if (tenant && tenant.unit) {
      // Verify tenant is in this property
      const unit = Array.isArray(tenant.unit) ? tenant.unit[0] : tenant.unit;
      if (unit.property_id === this.propertyId) {
        return {
          verified: true,
          tenant: {
            id: tenant.id,
            name: tenant.name,
            phone: tenant.phone,
            email: tenant.email,
            unit_id: tenant.unit_id,
            unit: unit,
          },
          property: await this.getProperty(),
          attempts: 0,
          verificationMethod: 'phone_lookup',
        };
      }
    }

    // Not found - need name/unit verification
    return {
      verified: false,
      tenant: null,
      property: await this.getProperty(),
      attempts: 0,
      verificationMethod: 'unverified',
    };
  }

  /**
   * Parse claimed identity from conversation transcript
   */
  parseClaimedIdentity(transcript: string): ClaimedIdentity {
    return parseIdentity(transcript);
  }

  /**
   * Attempt to match claimed name and unit to a tenant in the property
   */
  async attemptMatch(claimedName: string, claimedUnit: string): Promise<VerificationResult> {
    this.attempts++;

    // Get all tenants for this property
    const { data: tenants } = await getSupabase()
      .from('tenants')
      .select(`
        id,
        name,
        phone,
        email,
        unit_id,
        unit:units!inner(id, unit_number, property_id)
      `)
      .eq('unit.property_id', this.propertyId)
      .eq('is_active', true);

    if (!tenants) {
      return this.buildUnverifiedResult();
    }

    // Try exact match first
    for (const tenant of tenants) {
      const unit = Array.isArray(tenant.unit) ? tenant.unit[0] : tenant.unit;
      const unitMatch = normalizeUnit(unit.unit_number) === normalizeUnit(claimedUnit);
      const nameMatch = fuzzyNameMatch(tenant.name, claimedName);

      if (unitMatch && nameMatch) {
        return {
          verified: true,
          tenant: {
            id: tenant.id,
            name: tenant.name,
            phone: tenant.phone,
            email: tenant.email,
            unit_id: tenant.unit_id,
            unit: unit,
          },
          property: await this.getProperty(),
          attempts: this.attempts,
          verificationMethod: 'name_unit_match',
        };
      }
    }

    // Partial match - unit only with fuzzy name
    for (const tenant of tenants) {
      const unit = Array.isArray(tenant.unit) ? tenant.unit[0] : tenant.unit;
      if (normalizeUnit(unit.unit_number) === normalizeUnit(claimedUnit)) {
        const nameMatch = fuzzyNameMatch(tenant.name, claimedName);
        if (nameMatch) {
          return {
            verified: true,
            tenant: {
              id: tenant.id,
              name: tenant.name,
              phone: tenant.phone,
              email: tenant.email,
              unit_id: tenant.unit_id,
              unit: unit,
            },
            property: await this.getProperty(),
            attempts: this.attempts,
            verificationMethod: 'name_unit_match',
          };
        }
      }
    }

    return this.buildUnverifiedResult();
  }

  /**
   * Get property details
   */
  private async getProperty(): Promise<PropertyContextWithAddress | null> {
    const { data: property } = await getSupabase()
      .from('properties')
      .select('id, name, address, user_id')
      .eq('id', this.propertyId)
      .single();

    return property;
  }

  /**
   * Build an unverified result with current attempts
   */
  private async buildUnverifiedResult(): Promise<VerificationResult> {
    return {
      verified: false,
      tenant: null,
      property: await this.getProperty(),
      attempts: this.attempts,
      verificationMethod: 'unverified',
    };
  }

  /**
   * Check if max verification attempts have been reached
   */
  hasReachedMaxAttempts(): boolean {
    return this.attempts >= this.maxAttempts;
  }

  /**
   * Create an unverified request record for PM review
   */
  async createUnverifiedRequest(data: UnverifiedRequestData): Promise<string | null> {
    const { data: request, error } = await getSupabase()
      .from('unverified_requests')
      .insert({
        user_id: data.userId,
        property_id: this.propertyId,
        phone_number: normalizePhone(data.phoneNumber),
        channel: 'voice',
        claimed_name: data.claimedName,
        claimed_unit: data.claimedUnit,
        issue_description: data.issueDescription,
        transcript: data.transcript,
        ai_summary: data.aiSummary,
        call_record_id: data.callRecordId,
        status: 'pending_review',
        verification_attempts: this.attempts,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Failed to create unverified request:', error);
      return null;
    }

    return request?.id || null;
  }
}

/**
 * Get property context from phone number
 */
export async function getPropertyFromPhone(toPhone: string): Promise<PropertyContext | null> {
  const normalizedTo = normalizePhone(toPhone);

  const { data: propertyPhone } = await getSupabase()
    .from('property_phone_numbers')
    .select(`
      property:properties(id, name, address, user_id)
    `)
    .eq('phone_number', normalizedTo)
    .eq('is_active', true)
    .maybeSingle();

  if (propertyPhone?.property) {
    const property = Array.isArray(propertyPhone.property)
      ? propertyPhone.property[0]
      : propertyPhone.property;
    return property;
  }

  return null;
}
