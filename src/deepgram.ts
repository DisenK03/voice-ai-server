/**
 * Deepgram Streaming Speech-to-Text
 *
 * Real-time transcription with ~300ms latency.
 * Converts Twilio's mulaw audio to text as the caller speaks.
 *
 * Includes: circuit breaker, retry logic, cost tracking
 */

import { config } from 'dotenv';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { getCircuitBreaker, withRetry, costTracker } from './utils/index.js';

config();

function getDeepgramApiKey(): string {
  return process.env.DEEPGRAM_API_KEY || '';
}

export interface DeepgramSTT {
  send: (audio: Buffer) => void;
  close: () => void;
}

interface DeepgramConfig {
  sessionId?: string;
  onTranscript: (transcript: string, isFinal: boolean) => void;
  onError: (error: Error) => void;
}

// Circuit breaker for Deepgram
const deepgramCircuit = getCircuitBreaker('deepgram', {
  failureThreshold: 3,
  successThreshold: 2,
  timeout: 30000, // 30 seconds before retry
  onStateChange: (name, from, to) => {
    console.log(`[Deepgram Circuit] ${from} → ${to}`);
  },
});

export async function createDeepgramSTT(config: DeepgramConfig): Promise<DeepgramSTT> {
  const sessionId = config.sessionId || 'unknown';

  // Use circuit breaker to protect against repeated failures
  return deepgramCircuit.execute(async () => {
    return withRetry(
      async () => createDeepgramConnection(config, sessionId),
      {
        maxRetries: 2,
        baseDelayMs: 500,
        onRetry: (attempt, error, delayMs) => {
          console.log(`[Deepgram:${sessionId.slice(0, 8)}] Retry ${attempt} after ${delayMs}ms: ${error.message}`);
        },
      }
    );
  });
}

// Connection timeout for Deepgram WebSocket
const DEEPGRAM_CONNECTION_TIMEOUT_MS = 10000; // 10 seconds

async function createDeepgramConnection(config: DeepgramConfig, sessionId: string): Promise<DeepgramSTT> {
  const deepgram = createClient(getDeepgramApiKey());
  let audioDurationMs = 0;
  let connectionStartTime = Date.now();
  let connectionEstablished = false;

  // Settings tuned for complete utterance capture - waits for user to fully finish
  const connection = deepgram.listen.live({
    model: 'nova-2',
    language: 'en-US',
    smart_format: true,
    encoding: 'mulaw',
    sample_rate: 8000,
    channels: 1,
    interim_results: true,
    utterance_end_ms: 3000,  // Wait 3 seconds of silence before ending utterance
    vad_events: true,
    endpointing: 1500,       // 1.5 second patience - captures complete thoughts
    punctuate: true,         // Better sentence structure
    diarize: false,          // Single speaker
  });

  // Handle transcription results
  connection.on(LiveTranscriptionEvents.Transcript, (data) => {
    const transcript = data.channel?.alternatives?.[0]?.transcript || '';
    const isFinal = data.is_final || false;

    // Track duration from metadata if available
    if (data.duration) {
      audioDurationMs += data.duration * 1000;
    }

    if (transcript) {
      config.onTranscript(transcript, isFinal);
    }
  });

  // Handle errors
  connection.on(LiveTranscriptionEvents.Error, (error) => {
    console.error(`[Deepgram:${sessionId.slice(0, 8)}] Error:`, error);
    config.onError(new Error(String(error)));
  });

  // Handle connection open
  connection.on(LiveTranscriptionEvents.Open, () => {
    console.log(`[Deepgram:${sessionId.slice(0, 8)}] Connection opened`);
    connectionStartTime = Date.now();
    connectionEstablished = true;
  });

  // Connection timeout - reject if not established within timeout
  const connectionTimeout = setTimeout(() => {
    if (!connectionEstablished) {
      console.error(`[Deepgram:${sessionId.slice(0, 8)}] Connection timeout after ${DEEPGRAM_CONNECTION_TIMEOUT_MS}ms`);
      connection.requestClose();
      config.onError(new Error('Deepgram connection timeout'));
    }
  }, DEEPGRAM_CONNECTION_TIMEOUT_MS);

  // Handle connection close
  connection.on(LiveTranscriptionEvents.Close, () => {
    clearTimeout(connectionTimeout); // Clear the connection timeout
    const totalDurationMs = Date.now() - connectionStartTime;
    console.log(`[Deepgram:${sessionId.slice(0, 8)}] Connection closed (${totalDurationMs}ms)`);

    // Track cost based on connection duration
    if (totalDurationMs > 0) {
      costTracker.trackDeepgram(sessionId, totalDurationMs);
    }
  });

  return {
    send: (audio: Buffer) => {
      if (connection.getReadyState() === 1) {
        // Convert Buffer to ArrayBuffer for Deepgram SDK
        const arrayBuffer = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength);
        connection.send(arrayBuffer);
        // Track audio duration (~20ms per 160-byte chunk at 8kHz mulaw)
        audioDurationMs += 20;
      }
    },
    close: () => {
      clearTimeout(connectionTimeout);
      connection.requestClose();
    },
  };
}

// Export circuit stats for health endpoint
export function getDeepgramCircuitStats() {
  return deepgramCircuit.stats;
}
