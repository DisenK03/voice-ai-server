/**
 * Supabase Integration
 *
 * Fetches property/tenant context and creates work orders.
 */

import { config } from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { PropertyContext, TenantContext } from './voice-session/types.js';

// Re-export types for convenience
export type { PropertyContext, TenantContext } from './voice-session/types.js';

// Load env vars before accessing them
config();

let supabase: SupabaseClient;
let openai: OpenAI;

/**
 * Get the shared Supabase client instance.
 * Uses singleton pattern for connection pooling efficiency.
 */
export function getSupabase(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error('Supabase credentials not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
    }

    supabase = createClient(url, key, {
      auth: { persistSession: false }, // Server-side doesn't need session persistence
    });
  }
  return supabase;
}

function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || '',
    });
  }
  return openai;
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return '+1' + digits;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return '+' + digits;
  }
  return phone.startsWith('+') ? phone : '+' + digits;
}

export async function getPropertyContext(
  toPhone: string,
  fromPhone: string
): Promise<{ property: PropertyContext | null; tenant: TenantContext | null }> {
  const normalizedTo = normalizePhone(toPhone);
  const normalizedFrom = normalizePhone(fromPhone);

  // Look up property by phone number
  const { data: propertyPhone } = await getSupabase()
    .from('property_phone_numbers')
    .select('*, property:properties(*)')
    .eq('phone_number', normalizedTo)
    .eq('is_active', true)
    .maybeSingle();

  // Look up tenant by phone
  const { data: tenant } = await getSupabase()
    .from('tenants')
    .select('*, unit:units(*)')
    .eq('phone', normalizedFrom)
    .eq('is_active', true)
    .maybeSingle();

  // Type assertions - Supabase returns unknown types from dynamic queries
  const property = propertyPhone?.property as PropertyContext | null;
  const typedTenant = tenant as TenantContext | null;

  return {
    property: property || null,
    tenant: typedTenant || null,
  };
}

interface CreateWorkOrderParams {
  propertyContext: PropertyContext | null;
  tenantContext: TenantContext | null;
  conversationHistory: Array<{ role: string; content: string }>;
  issueDescription: string;
}

export async function createWorkOrder(params: CreateWorkOrderParams): Promise<string | null> {
  const { propertyContext, tenantContext, conversationHistory, issueDescription } = params;

  if (!propertyContext || !tenantContext) {
    console.log('Cannot create work order - missing context');
    return null;
  }

  // Use AI to extract ticket details
  const extractPrompt = `Extract maintenance ticket details from this conversation. Return JSON only:
{
  "title": "Brief issue title (5 words max)",
  "description": "Detailed description of the issue",
  "category": "plumbing|electrical|hvac|appliance|structural|pest|other",
  "priority": "low|medium|high|emergency",
  "location": "Where in the unit the issue is"
}`;

  let ticketDetails;
  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: extractPrompt },
        { role: 'user', content: issueDescription },
      ],
      max_tokens: 200,
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content || '{}';
    ticketDetails = JSON.parse(content.replace(/```json\n?|\n?```/g, ''));
  } catch (error) {
    console.error('Failed to extract ticket details:', error);
    ticketDetails = {
      title: 'Maintenance Request via Phone',
      description: issueDescription,
      category: 'other',
      priority: 'medium',
      location: 'Not specified',
    };
  }

  // Build transcript
  const transcript = conversationHistory.map((m) => `${m.role}: ${m.content}`).join('\n');

  // Create the work order
  const { data: workOrder, error } = await getSupabase()
    .from('work_orders')
    .insert({
      user_id: propertyContext.user_id,
      property_id: propertyContext.id,
      unit_id: tenantContext.unit_id,
      tenant_id: tenantContext.id,
      title: ticketDetails.title,
      description: ticketDetails.description,
      category: ticketDetails.category,
      priority: ticketDetails.priority,
      status: 'pending',
      source: 'phone',
      ai_summary: `Phone call transcript:\n${transcript}`,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create work order:', error);
    return null;
  }

  console.log('Created work order:', workOrder.id);

  // Notify PM
  await getSupabase().from('notifications').insert({
    user_id: propertyContext.user_id,
    type: 'new_work_order',
    title: 'New Maintenance Request (Phone)',
    message: `${tenantContext.name} called about: ${ticketDetails.title}`,
    read: false,
    metadata: { work_order_id: workOrder.id },
  });

  return workOrder.id;
}
