/**
 * Session Recorder
 *
 * Records call sessions to the database:
 * - Creates call_record entries
 * - Appends transcript chunks
 * - Logs to tenant_interactions audit trail
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { config } from 'dotenv';

config();

// Re-export utility functions
export { logVerificationAttempt, logWorkOrderEvent } from './interaction-logger.js';

let supabase: SupabaseClient;
let openai: OpenAI;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );
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

export type CallDirection = 'inbound' | 'outbound';
export type CallStatus = 'initiated' | 'ringing' | 'in_progress' | 'completed' | 'failed' | 'no_answer' | 'busy';

interface CallRecordData {
  userId: string;
  tenantId?: string;
  propertyId?: string;
  workOrderId?: string;
  direction: CallDirection;
  fromPhone: string;
  toPhone: string;
  twilioCallSid: string;
  triggerType?: 'status_update' | 'pm_approval' | 'follow_up' | 'manual' | 'inbound';
  triggerId?: string;
}

export class SessionRecorder {
  private callRecordId: string | null = null;
  private transcriptChunks: Array<{ role: 'caller' | 'ai'; text: string; timestamp: Date }> = [];
  private startedAt: Date | null = null;

  /**
   * Start recording a new call session
   */
  async startRecording(data: CallRecordData): Promise<string | null> {
    this.startedAt = new Date();

    const { data: callRecord, error } = await getSupabase()
      .from('call_records')
      .insert({
        user_id: data.userId,
        tenant_id: data.tenantId || null,
        property_id: data.propertyId || null,
        work_order_id: data.workOrderId || null,
        direction: data.direction,
        from_phone: data.fromPhone,
        to_phone: data.toPhone,
        twilio_call_sid: data.twilioCallSid,
        status: 'initiated',
        started_at: this.startedAt.toISOString(),
        trigger_type: data.triggerType || (data.direction === 'inbound' ? 'inbound' : null),
        trigger_id: data.triggerId || null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Failed to create call record:', error);
      return null;
    }

    this.callRecordId = callRecord?.id || null;
    return this.callRecordId;
  }

  /**
   * Update call status
   */
  async updateStatus(status: CallStatus): Promise<void> {
    if (!this.callRecordId) return;

    await getSupabase()
      .from('call_records')
      .update({ status })
      .eq('id', this.callRecordId);
  }

  /**
   * Add a transcript segment
   */
  appendTranscript(role: 'caller' | 'ai', text: string): void {
    if (text.trim()) {
      this.transcriptChunks.push({
        role,
        text: text.trim(),
        timestamp: new Date(),
      });
    }
  }

  /**
   * Get the full transcript as formatted text
   */
  getFullTranscript(): string {
    return this.transcriptChunks
      .map((chunk) => `${chunk.role === 'caller' ? 'Caller' : 'AI'}: ${chunk.text}`)
      .join('\n');
  }

  /**
   * Generate AI summary of the transcript
   */
  async generateSummary(): Promise<string> {
    const transcript = this.getFullTranscript();
    if (!transcript) return '';

    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Summarize this property maintenance call in 2-3 sentences. Focus on:
- Who called (name, unit if mentioned)
- What issue they reported
- What action was taken (ticket created, callback scheduled, etc.)
Keep it concise and factual.`,
          },
          {
            role: 'user',
            content: transcript,
          },
        ],
        max_tokens: 150,
        temperature: 0.3,
      });

      return response.choices[0]?.message?.content || '';
    } catch (error) {
      console.error('Failed to generate summary:', error);
      return '';
    }
  }

  /**
   * End the recording and save final data
   */
  async endRecording(additionalData?: {
    tenantId?: string;
    workOrderId?: string;
  }): Promise<void> {
    if (!this.callRecordId) return;

    const endedAt = new Date();
    const durationSeconds = this.startedAt
      ? Math.round((endedAt.getTime() - this.startedAt.getTime()) / 1000)
      : 0;

    const transcript = this.getFullTranscript();
    const summary = await this.generateSummary();

    const updateData: Record<string, unknown> = {
      status: 'completed',
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
      transcript,
      transcript_summary: summary,
    };

    if (additionalData?.tenantId) {
      updateData.tenant_id = additionalData.tenantId;
    }
    if (additionalData?.workOrderId) {
      updateData.work_order_id = additionalData.workOrderId;
    }

    await getSupabase()
      .from('call_records')
      .update(updateData)
      .eq('id', this.callRecordId);
  }

  /**
   * Link this call to a tenant and log interaction
   */
  async linkToTenant(tenantId: string, userId: string, workOrderId?: string): Promise<void> {
    if (!this.callRecordId) return;

    await getSupabase()
      .from('call_records')
      .update({
        tenant_id: tenantId,
        work_order_id: workOrderId || null,
      })
      .eq('id', this.callRecordId);

    await this.logTenantInteraction(tenantId, userId, workOrderId);
  }

  /**
   * Log an interaction to the tenant's audit trail
   */
  async logTenantInteraction(
    tenantId: string,
    userId: string,
    workOrderId?: string,
    customContent?: string
  ): Promise<void> {
    const transcript = this.getFullTranscript();
    const summary = await this.generateSummary();

    const { data: callRecord } = await getSupabase()
      .from('call_records')
      .select('direction')
      .eq('id', this.callRecordId)
      .single();

    const interactionType = callRecord?.direction === 'outbound' ? 'call_outbound' : 'call_inbound';

    await getSupabase().from('tenant_interactions').insert({
      tenant_id: tenantId,
      user_id: userId,
      interaction_type: interactionType,
      channel: 'voice',
      content: customContent || transcript,
      ai_summary: summary,
      call_record_id: this.callRecordId,
      work_order_id: workOrderId || null,
      metadata: {
        duration_seconds: this.startedAt
          ? Math.round((Date.now() - this.startedAt.getTime()) / 1000)
          : 0,
      },
    });
  }

  getCallRecordId(): string | null {
    return this.callRecordId;
  }

  getDurationSeconds(): number {
    if (!this.startedAt) return 0;
    return Math.round((Date.now() - this.startedAt.getTime()) / 1000);
  }
}
