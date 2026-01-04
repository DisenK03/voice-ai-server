/**
 * Real-Time Voice AI Server
 *
 * Production-grade voice AI with WebSocket streaming for ~1 second latency.
 *
 * Architecture:
 * Twilio <-(WebSocket)-> This Server <-(Streaming)-> Deepgram STT
 *                                    <-(Streaming)-> OpenAI LLM
 *                                    <-(Streaming)-> ElevenLabs TTS
 *
 * Features:
 * - Circuit breakers for all external APIs
 * - Retry logic with exponential backoff
 * - Cost tracking per session
 * - Latency metrics
 * - Correlation IDs for request tracing
 */

import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import formbody from '@fastify/formbody';
import { config } from 'dotenv';

import { gracefulShutdown, startSessionCleanup } from './server/session-manager.js';
import { registerRoutes } from './server/routes.js';
import { registerWebSocketHandlers } from './server/websocket-handlers.js';

config();

const PORT = parseInt(process.env.PORT || '3001');
const HOST = process.env.HOST || '0.0.0.0';

// Create Fastify instance
const fastify = Fastify({
  logger: true,
});

// Register plugins
await fastify.register(websocket);
await fastify.register(formbody); // For Twilio webhooks (form-urlencoded)

// Register routes and handlers
registerRoutes(fastify);
registerWebSocketHandlers(fastify);

// Start periodic session cleanup
startSessionCleanup();

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM', fastify));
process.on('SIGINT', () => gracefulShutdown('SIGINT', fastify));

// Start server
try {
  await fastify.listen({ port: PORT, host: HOST });
  console.log(`Voice AI Server running on ${HOST}:${PORT}`);
  console.log(`Health check: http://${HOST}:${PORT}/health`);
  console.log(`Stats: http://${HOST}:${PORT}/stats`);
  console.log(`WebSocket: ws://${HOST}:${PORT}/media-stream`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
