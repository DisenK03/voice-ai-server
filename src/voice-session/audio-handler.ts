/**
 * Voice Session - Audio Handler
 *
 * Handles audio streaming between Twilio, Deepgram, and ElevenLabs.
 */

import { WebSocket } from 'ws';
import { createDeepgramSTT, DeepgramSTT } from '../deepgram.js';
import { createElevenLabsTTS, ElevenLabsTTS } from '../elevenlabs.js';
import { SessionLogger } from '../utils/index.js';

export interface AudioConfig {
  sessionId: string;
  log: SessionLogger;
  socket: WebSocket;
  streamSid: string;
  onTranscript: (transcript: string, isFinal: boolean) => void;
}

export interface AudioComponents {
  deepgram: DeepgramSTT | null;
  tts: ElevenLabsTTS | null;
  totalTTSCharacters: number;
  totalSTTDurationMs: number;
}

/**
 * Initialize audio components (STT and TTS)
 */
export async function initializeAudio(config: AudioConfig): Promise<AudioComponents> {
  const { log, sessionId, socket, streamSid, onTranscript } = config;

  // Initialize Deepgram STT
  log.startTimer('deepgram_init');
  const deepgram = await createDeepgramSTT({
    sessionId,
    onTranscript,
    onError: (error) => log.error('Deepgram error', { error: error.message }),
  });
  log.infoWithLatency('deepgram_init', 'Deepgram STT initialized');

  // Initialize ElevenLabs TTS
  log.startTimer('elevenlabs_init');
  const tts = await createElevenLabsTTS({
    sessionId,
    onAudio: (audioChunk) => sendAudioToTwilio(socket, streamSid, audioChunk),
    onDone: () => log.debug('TTS chunk complete'),
  });
  log.infoWithLatency('elevenlabs_init', 'ElevenLabs TTS initialized');

  return {
    deepgram,
    tts,
    totalTTSCharacters: 0,
    totalSTTDurationMs: 0,
  };
}

/**
 * Process incoming audio from Twilio
 */
export function handleIncomingAudio(
  deepgram: DeepgramSTT | null,
  base64Audio: string
): number {
  if (deepgram) {
    const audioBuffer = Buffer.from(base64Audio, 'base64');
    deepgram.send(audioBuffer);
    // Return duration added (~20ms per chunk at 8kHz mulaw)
    return 20;
  }
  return 0;
}

/**
 * Send text to TTS for speech synthesis
 */
export function speakText(
  tts: ElevenLabsTTS | null,
  text: string
): number {
  if (tts) {
    tts.addText(text);
    tts.flush();
    return text.length;
  }
  return 0;
}

/**
 * Add text to TTS stream (for token streaming)
 */
export function addTTSText(
  tts: ElevenLabsTTS | null,
  text: string
): number {
  if (tts) {
    tts.addText(text);
    return text.length;
  }
  return 0;
}

/**
 * Flush remaining TTS audio
 */
export function flushTTS(tts: ElevenLabsTTS | null): void {
  if (tts) {
    tts.flush();
  }
}

/**
 * Send audio chunk to Twilio
 */
function sendAudioToTwilio(
  socket: WebSocket,
  streamSid: string,
  audioChunk: Buffer
): void {
  const base64Audio = audioChunk.toString('base64');
  const message = {
    event: 'media',
    streamSid,
    media: { payload: base64Audio },
  };

  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

/**
 * Cleanup audio components
 */
export function cleanupAudio(components: AudioComponents): void {
  if (components.deepgram) {
    components.deepgram.close();
    components.deepgram = null;
  }
  if (components.tts) {
    components.tts.close();
    components.tts = null;
  }
}
