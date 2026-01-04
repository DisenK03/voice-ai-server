/**
 * ElevenLabs Streaming Text-to-Speech
 *
 * Streams audio chunks back as text is received.
 * Uses WebSocket connection for real-time TTS with ~200ms latency.
 *
 * Includes: circuit breaker, retry logic, cost tracking
 */

import { config } from 'dotenv';
import { WebSocket } from 'ws';
import { getCircuitBreaker, withRetry, costTracker } from './utils/index.js';

config();

function getElevenLabsApiKey(): string {
  return process.env.ELEVENLABS_API_KEY || '';
}

function getVoiceId(): string {
  return process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Rachel - warmer, more natural
}

export interface ElevenLabsTTS {
  addText: (text: string) => void;
  flush: () => void;
  close: () => void;
}

interface ElevenLabsConfig {
  sessionId?: string;
  onAudio: (audioChunk: Buffer) => void;
  onDone: () => void;
}

// Circuit breaker for ElevenLabs
const elevenLabsCircuit = getCircuitBreaker('elevenlabs', {
  failureThreshold: 3,
  successThreshold: 2,
  timeout: 60000, // 1 minute before retry
  onStateChange: (name, from, to) => {
    console.log(`[ElevenLabs Circuit] ${from} → ${to}`);
  },
});

export async function createElevenLabsTTS(config: ElevenLabsConfig): Promise<ElevenLabsTTS> {
  const sessionId = config.sessionId || 'unknown';

  // Use circuit breaker to protect against repeated failures
  return elevenLabsCircuit.execute(async () => {
    return withRetry(
      async () => createElevenLabsConnection(config, sessionId),
      {
        maxRetries: 2,
        baseDelayMs: 1000,
        onRetry: (attempt, error, delayMs) => {
          console.log(`[ElevenLabs:${sessionId.slice(0, 8)}] Retry ${attempt} after ${delayMs}ms: ${error.message}`);
        },
      }
    );
  });
}

async function createElevenLabsConnection(config: ElevenLabsConfig, sessionId: string): Promise<ElevenLabsTTS> {
  const apiKey = getElevenLabsApiKey();
  const voiceId = getVoiceId();
  const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=eleven_turbo_v2_5&output_format=ulaw_8000`;

  let ws: WebSocket;
  let isReady = false;
  let textBuffer = '';
  let totalCharacters = 0;
  let keepAliveInterval: NodeJS.Timeout | null = null;
  let isClosed = false;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 3;
  const BASE_RECONNECT_DELAY_MS = 500;

  // Function to create and setup WebSocket connection
  const setupWebSocket = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      ws = new WebSocket(wsUrl, {
        headers: {
          'xi-api-key': apiKey,
        },
      });

      ws.on('open', () => {
        console.log(`[ElevenLabs:${sessionId.slice(0, 8)}] WebSocket connected`);

        // Send initial configuration (BOS message)
        // Voice tuned for helpful, professional assistant - natural pace
        ws.send(
          JSON.stringify({
            text: ' ',
            voice_settings: {
              stability: 0.6,          // Balanced - consistent but not robotic
              similarity_boost: 0.75,  // Natural voice matching
              style: 0.35,             // Friendly but professional, not over-the-top
              use_speaker_boost: true,
              speed: 0.92,             // Natural conversational speed
            },
            generation_config: {
              chunk_length_schedule: [120, 160, 200, 260], // Natural phrase length
            },
          })
        );

        isReady = true;

        // Start keep-alive pings every 15 seconds to prevent timeout
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        keepAliveInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN && !isClosed) {
            // Send a space to keep connection alive (won't produce audio)
            ws.send(JSON.stringify({ text: ' ', try_trigger_generation: false }));
          }
        }, 15000);

        resolve();
      });

      ws.on('error', (error) => {
        console.error(`[ElevenLabs:${sessionId.slice(0, 8)}] WebSocket error:`, error);
        reject(error);
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.audio) {
            const audioBuffer = Buffer.from(message.audio, 'base64');
            config.onAudio(audioBuffer);
          }
          if (message.isFinal) {
            config.onDone();
          }
        } catch (error) {
          if (Buffer.isBuffer(data)) {
            config.onAudio(data as Buffer);
          }
        }
      });

      ws.on('close', (code, reason) => {
        console.log(`[ElevenLabs:${sessionId.slice(0, 8)}] WebSocket closed:`, code, reason?.toString());
        isReady = false;

        // Clear keep-alive on close
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
          keepAliveInterval = null;
        }

        // Track cost on close
        if (totalCharacters > 0) {
          costTracker.trackElevenLabs(sessionId, totalCharacters);
          totalCharacters = 0; // Reset for potential reconnection
        }

        // Auto-reconnect with exponential backoff if not intentionally closed
        if (!isClosed && code === 1008 && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          // Exponential backoff with jitter: 500ms, 1000ms, 2000ms + random 0-500ms
          const delay = BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts - 1) + Math.random() * 500;
          console.log(`[ElevenLabs:${sessionId.slice(0, 8)}] Auto-reconnecting in ${Math.round(delay)}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
          setTimeout(() => {
            if (!isClosed) {
              setupWebSocket().catch((err) => {
                console.error(`[ElevenLabs:${sessionId.slice(0, 8)}] Reconnection failed:`, err);
              });
            }
          }, delay);
        } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.error(`[ElevenLabs:${sessionId.slice(0, 8)}] Max reconnect attempts reached, giving up`);
        }
      });

      setTimeout(() => reject(new Error('ElevenLabs connection timeout')), 5000);
    });
  };

  // Initial connection
  await setupWebSocket();

  return {
    addText: (text: string) => {
      if (!isReady || ws.readyState !== WebSocket.OPEN) {
        textBuffer += text;
        return;
      }

      // Send text to ElevenLabs
      const textToSend = textBuffer + text;
      textBuffer = '';

      // Filter out ALL special tags before sending to TTS
      const cleanText = textToSend
        .replace(/\[CREATE_TICKET\]/g, '')
        .replace(/\[CREATE_UNVERIFIED\]/g, '')
        .replace(/\[END_CALL\]/g, '')
        .replace(/\[TENANT:[^\]]+\]/g, '')
        .replace(/\[VERIFIED\]/g, '')
        .replace(/\[[A-Z_]+\]/g, ''); // Catch any other bracketed tags

      if (cleanText.trim()) {
        totalCharacters += cleanText.length;
        ws.send(
          JSON.stringify({
            text: cleanText,
            try_trigger_generation: true,
          })
        );
      }
    },

    flush: () => {
      if (ws.readyState === WebSocket.OPEN) {
        // Send empty string with flush flag to generate remaining audio
        ws.send(
          JSON.stringify({
            text: '',
            flush: true,
          })
        );
      }
    },

    close: () => {
      isClosed = true; // Prevent auto-reconnect
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
      if (ws.readyState === WebSocket.OPEN) {
        // Send EOS signal
        ws.send(JSON.stringify({ text: '' }));
        ws.close();
      }
    },
  };
}

// Export circuit stats for health endpoint
export function getElevenLabsCircuitStats() {
  return elevenLabsCircuit.stats;
}
