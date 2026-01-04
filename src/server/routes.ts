/**
 * HTTP Routes
 *
 * REST API endpoints for health checks, stats, and Twilio webhooks.
 */

import { FastifyInstance } from 'fastify';
import { getPropertyContext } from '../supabase.js';
import { SMSSession, getSMSCircuitStats } from '../sms-session.js';
import { getAllCircuitStats, costTracker, getMetrics } from '../utils/index.js';
import { getElevenLabsCircuitStats } from '../elevenlabs.js';
import { getDeepgramCircuitStats } from '../deepgram.js';
import { getOpenAICircuitStats } from '../openai.js';
import { validateTwilioRequest } from '../utils/twilio-validation.js';

/**
 * Escape XML special characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Register all HTTP routes
 */
export function registerRoutes(fastify: FastifyInstance): void {
  // Health check endpoint with circuit breaker status
  fastify.get('/health', async () => {
    const circuits = {
      elevenlabs: getElevenLabsCircuitStats(),
      deepgram: getDeepgramCircuitStats(),
      openai: getOpenAICircuitStats(),
      smsOpenai: getSMSCircuitStats(),
    };

    const allClosed = Object.values(circuits).every((c) => c.state === 'CLOSED');

    return {
      status: allClosed ? 'ok' : 'degraded',
      service: 'voice-ai-server',
      circuits,
    };
  });

  // Stats endpoint for monitoring
  fastify.get('/stats', async () => {
    return {
      circuits: getAllCircuitStats(),
      costs: costTracker.getStats(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    };
  });

  // Prometheus metrics endpoint
  fastify.get('/metrics', async (request, reply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return getMetrics();
  });

  // Detailed circuit breaker status
  fastify.get('/circuits', async () => {
    return {
      elevenlabs: getElevenLabsCircuitStats(),
      deepgram: getDeepgramCircuitStats(),
      openai: getOpenAICircuitStats(),
      smsOpenai: getSMSCircuitStats(),
    };
  });

  // SMS webhook endpoint for Twilio
  fastify.post('/sms', async (request, reply) => {
    try {
      const body = request.body as Record<string, string>;

      // Validate Twilio signature FIRST - reject unauthorized requests
      // Pass the request path - validateTwilioRequest will reconstruct the full URL
      // using forwarded headers from the proxy
      const isValid = validateTwilioRequest(
        request.headers as Record<string, string | string[] | undefined>,
        request.url,
        body
      );
      if (!isValid) {
        console.error('[SMS] Invalid Twilio signature - rejecting request');
        reply.status(401);
        return 'Unauthorized';
      }

      const fromPhone = body.From || '';
      const toPhone = body.To || '';
      const messageBody = body.Body || '';

      console.log(`[SMS] Incoming from ${fromPhone}: ${messageBody.slice(0, 50)}...`);

      // Get property/tenant context
      const context = await getPropertyContext(toPhone, fromPhone);

      // Create SMS session and process
      const session = new SMSSession({
        fromPhone,
        toPhone,
        body: messageBody,
        propertyId: context.property?.id,
        propertyName: context.property?.name,
        tenantId: context.tenant?.id,
        tenantName: context.tenant?.name,
        userId: context.property?.user_id,
      });

      const response = await session.processMessage();

      // Return TwiML response
      reply.header('Content-Type', 'text/xml');
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(response)}</Message>
</Response>`;
    } catch (error) {
      console.error('[SMS] Error processing message:', error);
      reply.header('Content-Type', 'text/xml');
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Sorry, I'm having trouble right now. Please try again later.</Message>
</Response>`;
    }
  });

  // TwiML endpoint for inbound voice calls
  fastify.post('/twiml', async (request, reply) => {
    try {
      const body = request.body as Record<string, string>;

      // Validate Twilio signature FIRST - reject unauthorized requests
      const isValid = validateTwilioRequest(
        request.headers as Record<string, string | string[] | undefined>,
        request.url,
        body
      );
      if (!isValid) {
        console.error('[TwiML] Invalid Twilio signature - rejecting request');
        reply.status(401);
        return 'Unauthorized';
      }

      const fromPhone = body.From || '';
      const toPhone = body.To || '';
      const callSid = body.CallSid || '';

      console.log(`[TwiML] Inbound call from ${fromPhone} to ${toPhone} (${callSid})`);

      // Get the WebSocket URL (use wss:// for production)
      const serverUrl = process.env.VOICE_SERVER_URL || 'http://localhost:3001';
      const host = serverUrl.replace(/^https?:\/\//, '');
      const wsUrl = `wss://${host}/media-stream`;

      // Return TwiML that connects to our WebSocket stream
      reply.header('Content-Type', 'text/xml');
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="from" value="${escapeXml(fromPhone)}" />
      <Parameter name="to" value="${escapeXml(toPhone)}" />
    </Stream>
  </Connect>
</Response>`;
    } catch (error) {
      console.error('[TwiML] Error generating TwiML:', error);
      reply.header('Content-Type', 'text/xml');
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, we're experiencing technical difficulties. Please try again later.</Say>
  <Hangup/>
</Response>`;
    }
  });
}
