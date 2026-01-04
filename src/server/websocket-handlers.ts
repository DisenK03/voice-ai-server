/**
 * WebSocket Handlers
 *
 * Handles Twilio Media Stream WebSocket connections for
 * inbound and outbound voice calls.
 */

import { FastifyInstance } from 'fastify';
import { VoiceSession } from '../voice-session.js';
import { OutboundVoiceSession } from '../outbound-session/index.js';
import { getPropertyContext } from '../supabase.js';
import { trackSession, untrackSession } from './session-manager.js';

/**
 * Register WebSocket handlers for voice streams
 */
export function registerWebSocketHandlers(fastify: FastifyInstance): void {
  fastify.register(async function (fastify) {
    // Inbound call WebSocket endpoint
    fastify.get('/media-stream', { websocket: true }, (socket) => {
      console.log('New WebSocket connection from Twilio');

      let session: VoiceSession | null = null;

      socket.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());

          switch (message.event) {
            case 'connected':
              console.log('Twilio connected');
              break;

            case 'start': {
              // Call started - initialize session with context
              const { streamSid, callSid, customParameters } = message.start;
              console.log('Call started:', { streamSid, callSid, customParameters });

              // Get property/tenant context from Supabase
              const context = await getPropertyContext(
                customParameters?.to || '',
                customParameters?.from || ''
              );

              // Create voice session
              session = new VoiceSession({
                socket,
                streamSid,
                callSid,
                fromPhone: customParameters?.from || '',
                toPhone: customParameters?.to || '',
                propertyContext: context.property,
                tenantContext: context.tenant,
              });

              // Track session for graceful shutdown and cleanup
              trackSession(session);

              console.log(`[Session:${session.sessionId.slice(0, 8)}] Created for call ${callSid}`);

              // Start the conversation
              await session.start();
              break;
            }

            case 'media':
              // Incoming audio from caller - guard against null session
              if (!session) {
                // Session not yet initialized (start event not received)
                // Silently drop audio - this can happen briefly during connection
                break;
              }
              session.handleAudio(message.media.payload);
              break;

            case 'stop':
              console.log('Call ended');
              if (session) {
                untrackSession(session);
                await session.end();
                session = null;
              }
              break;
          }
        } catch (error) {
          console.error('Error processing message:', error);
        }
      });

      socket.on('close', () => {
        console.log('WebSocket closed');
        if (session) {
          untrackSession(session);
          session.end();
          session = null;
        }
      });

      socket.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    });

    // Outbound call WebSocket endpoint
    fastify.get('/outbound-stream', { websocket: true }, (socket) => {
      console.log('New outbound WebSocket connection from Twilio');

      let session: OutboundVoiceSession | null = null;

      socket.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());

          switch (message.event) {
            case 'connected':
              console.log('Twilio outbound connected');
              break;

            case 'start': {
              const { streamSid, callSid, customParameters } = message.start;
              console.log('Outbound call started:', { streamSid, callSid, customParameters });

              // Create outbound session with context from parameters
              session = new OutboundVoiceSession({
                socket,
                streamSid,
                callSid,
                tenantId: customParameters?.tenant_id || '',
                workOrderId: customParameters?.work_order_id || undefined,
                propertyId: customParameters?.property_id || '',
                callRecordId: customParameters?.call_record_id || '',
                triggerType: customParameters?.trigger_type || 'manual',
                fromPhone: customParameters?.from || '',
                toPhone: customParameters?.to || '',
              });

              // Track session for graceful shutdown and cleanup
              trackSession(session);

              console.log(`[Outbound:${session.sessionId.slice(0, 8)}] Created for call ${callSid}`);

              await session.start();
              break;
            }

            case 'media':
              // Incoming audio - guard against null session
              if (!session) {
                // Session not yet initialized, drop audio
                break;
              }
              session.handleAudio(message.media.payload);
              break;

            case 'stop':
              console.log('Outbound call ended');
              if (session) {
                untrackSession(session);
                await session.end();
                session = null;
              }
              break;
          }
        } catch (error) {
          console.error('Error processing outbound message:', error);
        }
      });

      socket.on('close', () => {
        console.log('Outbound WebSocket closed');
        if (session) {
          untrackSession(session);
          session.end();
          session = null;
        }
      });

      socket.on('error', (error) => {
        console.error('Outbound WebSocket error:', error);
      });
    });
  });
}
