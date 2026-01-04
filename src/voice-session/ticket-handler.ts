/**
 * Voice Session - Ticket Handler
 *
 * Creates work orders from voice conversations.
 */

import { SessionLogger } from '../utils/index.js';
import { SessionRecorder } from '../session-recorder/index.js';
import { createWorkOrder } from '../supabase.js';
import { TenantContext, PropertyContext, ConversationMessage } from './types.js';

export interface TicketContext {
  log: SessionLogger;
  recorder: SessionRecorder;
  propertyContext: PropertyContext | null;
  tenantContext: TenantContext | null;
}

/**
 * Create a work order from the conversation
 */
export async function createTicketFromConversation(
  ctx: TicketContext,
  conversationHistory: ConversationMessage[]
): Promise<string | null> {
  if (!ctx.tenantContext || !ctx.propertyContext) {
    ctx.log.warn('Cannot create ticket - missing context');
    return null;
  }

  ctx.log.startTimer('create_ticket');

  const userMessages = conversationHistory
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' ');

  const workOrderId = await createWorkOrder({
    propertyContext: ctx.propertyContext,
    tenantContext: ctx.tenantContext,
    conversationHistory: conversationHistory as Array<{ role: string; content: string }>,
    issueDescription: userMessages,
  });

  if (workOrderId) {
    // Link call record to work order
    await ctx.recorder.linkToTenant(
      ctx.tenantContext.id,
      ctx.propertyContext.user_id,
      workOrderId
    );
  }

  ctx.log.infoWithLatency('create_ticket', 'Work order created', {
    workOrderId,
  });

  return workOrderId;
}
