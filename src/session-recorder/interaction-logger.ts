/**
 * Session Recorder - Interaction Logger
 *
 * Utility functions for logging verification and work order events
 * to the tenant interactions audit trail.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

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
 * Log a verification attempt to tenant interactions
 */
export async function logVerificationAttempt(
  tenantId: string,
  userId: string,
  success: boolean,
  method: string
): Promise<void> {
  await getSupabase().from('tenant_interactions').insert({
    tenant_id: tenantId,
    user_id: userId,
    interaction_type: success ? 'verification_success' : 'verification_attempt',
    channel: 'voice',
    content: `Verification ${success ? 'successful' : 'attempted'} via ${method}`,
    ai_summary: null,
    metadata: { method, success },
  });
}

/**
 * Log a work order event to tenant interactions
 */
export async function logWorkOrderEvent(
  tenantId: string,
  userId: string,
  workOrderId: string,
  event: 'created' | 'updated' | 'closed',
  description?: string
): Promise<void> {
  const interactionType = `work_order_${event}` as const;

  await getSupabase().from('tenant_interactions').insert({
    tenant_id: tenantId,
    user_id: userId,
    interaction_type: interactionType,
    channel: 'system',
    content: description || `Work order ${event}`,
    work_order_id: workOrderId,
    metadata: { event },
  });
}
