/**
 * Voice Session
 *
 * Manages a single voice call with real-time streaming:
 * - Deepgram for streaming speech-to-text
 * - OpenAI for streaming LLM responses
 * - ElevenLabs for streaming text-to-speech
 *
 * Includes: caller verification, session recording, cost tracking, latency metrics
 */

import { WebSocket } from 'ws';
import { streamLLMResponse } from '../openai.js';
import { createSessionLogger, SessionLogger } from '../utils/index.js';
import { CallerVerification } from '../caller-verification/index.js';
import { SessionRecorder } from '../session-recorder/index.js';

import {
  VoiceSessionConfig,
  TenantContext,
  PropertyContext,
  ConversationMessage,
  MAX_CONVERSATION_MESSAGES,
} from './types.js';
import { performInitialVerification, handleVerificationAttempt, VerificationData } from './verification.js';
import { buildGreeting, buildSystemPrompt } from './prompts.js';
import { IssueData } from './issue-handler.js';
import { startDurationTimers, DurationTimers } from './duration-limits.js';
import {
  initializeAudio,
  handleIncomingAudio,
  speakText,
  addTTSText,
  flushTTS,
  AudioComponents,
} from './audio-handler.js';
import { parseResponse, handleTicketCreation, cleanResponse } from './response-parser.js';
import { handleEndSession } from './end-handler.js';

export class VoiceSession {
  private socket: WebSocket;
  private streamSid: string;
  private callSid: string;
  private fromPhone: string;
  private toPhone: string;
  private propertyContext: PropertyContext | null;
  private tenantContext: TenantContext | null;

  private log: SessionLogger;
  private recorder: SessionRecorder;
  private verifier: CallerVerification | null = null;

  private verificationData: VerificationData;
  private audio: AudioComponents | null = null;

  private conversationHistory: ConversationMessage[] = [];
  private currentTranscript = '';
  private isProcessing = false;
  private silenceTimer: NodeJS.Timeout | null = null;
  private autoEndTimer: NodeJS.Timeout | null = null;

  private shouldCreateTicket = false;
  private createdWorkOrderId: string | null = null;
  private issueData: IssueData = { category: null, description: null };

  private callStartTime: number = 0;
  private durationTimers: DurationTimers = {
    softLimitTimer: null,
    hardLimitTimer: null,
    hasHitSoftLimit: false,
  };

  constructor(config: VoiceSessionConfig) {
    this.socket = config.socket;
    this.streamSid = config.streamSid;
    this.callSid = config.callSid;
    this.fromPhone = config.fromPhone;
    this.toPhone = config.toPhone;
    this.propertyContext = config.propertyContext as PropertyContext | null;
    this.tenantContext = config.tenantContext as TenantContext | null;

    this.log = createSessionLogger(config.callSid, config.propertyContext?.id);
    this.recorder = new SessionRecorder();

    if (this.propertyContext?.id) {
      this.verifier = new CallerVerification(this.propertyContext.id);
    }

    this.verificationData = {
      state: 'PENDING',
      tenantContext: this.tenantContext,
      claimedName: null,
      claimedUnit: null,
      promptCount: 0,
      maxPrompts: 3,
      createdUnverifiedRequest: false,
    };
  }

  get sessionId(): string {
    return this.log.sessionId;
  }

  private addToConversationHistory(role: 'user' | 'assistant', content: string) {
    this.conversationHistory.push({ role, content });
    if (this.conversationHistory.length > MAX_CONVERSATION_MESSAGES) {
      this.conversationHistory = this.conversationHistory.slice(-MAX_CONVERSATION_MESSAGES);
    }
  }

  async start() {
    this.callStartTime = Date.now();
    this.log.info('Starting voice session', {
      callSid: this.callSid,
      propertyId: this.propertyContext?.id,
      tenantId: this.tenantContext?.id,
      fromPhone: this.fromPhone,
    });

    // Start recording
    if (this.propertyContext?.user_id) {
      await this.recorder.startRecording({
        userId: this.propertyContext.user_id,
        tenantId: this.tenantContext?.id,
        propertyId: this.propertyContext.id,
        direction: 'inbound',
        fromPhone: this.fromPhone,
        toPhone: this.toPhone,
        twilioCallSid: this.callSid,
        triggerType: 'inbound',
      });
    }

    // Perform initial verification
    const verificationResult = await performInitialVerification(
      { log: this.log, verifier: this.verifier, recorder: this.recorder, propertyContext: this.propertyContext, fromPhone: this.fromPhone },
      this.tenantContext
    );
    this.verificationData.state = verificationResult.state;
    if (verificationResult.tenant) {
      this.tenantContext = verificationResult.tenant;
      this.verificationData.tenantContext = verificationResult.tenant;
    }

    // Initialize audio
    this.audio = await initializeAudio({
      sessionId: this.log.sessionId,
      log: this.log,
      socket: this.socket,
      streamSid: this.streamSid,
      onTranscript: (transcript, isFinal) => this.handleTranscript(transcript, isFinal),
    });

    await this.recorder.updateStatus('in_progress');

    // Send greeting
    const greeting = buildGreeting({
      propertyContext: this.propertyContext,
      tenantContext: this.tenantContext,
      verificationState: this.verificationData.state,
      claimedName: this.verificationData.claimedName,
      claimedUnit: this.verificationData.claimedUnit,
    });
    this.audio.totalTTSCharacters += speakText(this.audio.tts, greeting);
    this.addToConversationHistory('assistant', greeting);
    this.recorder.appendTranscript('ai', greeting);

    // Start duration timers
    startDurationTimers(
      {
        log: this.log,
        recorder: this.recorder,
        callStartTime: this.callStartTime,
        speak: async (text) => {
          if (this.audio) this.audio.totalTTSCharacters += speakText(this.audio.tts, text);
        },
        addToConversationHistory: (role, content) => this.addToConversationHistory(role, content),
        end: () => this.end(),
      },
      this.durationTimers
    );
  }

  handleAudio(base64Audio: string) {
    if (this.audio) {
      this.audio.totalSTTDurationMs += handleIncomingAudio(this.audio.deepgram, base64Audio);
    }
  }

  private handleTranscript(transcript: string, isFinal: boolean) {
    if (!transcript.trim()) return;

    // Clear any existing timers - user is speaking
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.autoEndTimer) clearTimeout(this.autoEndTimer);

    // Accumulate transcripts - don't respond until user is truly done
    if (isFinal) {
      // Add final transcript to buffer with space separator
      if (this.currentTranscript && !this.currentTranscript.endsWith(transcript)) {
        this.currentTranscript = this.currentTranscript + ' ' + transcript;
      } else {
        this.currentTranscript = transcript;
      }
      this.log.info('Final transcript chunk', { chunk: transcript, accumulated: this.currentTranscript });
    } else {
      // For interim, just track it but don't accumulate
      this.log.debug('Interim transcript', { transcript });
    }

    // Wait for silence AFTER any transcript (final or interim)
    // This ensures we wait for user to finish their complete thought
    this.silenceTimer = setTimeout(() => {
      if (this.currentTranscript && !this.isProcessing) {
        const fullUtterance = this.currentTranscript.trim();
        this.log.info('User finished speaking', { transcript: fullUtterance });
        this.recorder.appendTranscript('caller', fullUtterance);
        this.currentTranscript = '';
        this.processUserInput(fullUtterance);
      }
    }, 1800); // Wait 1.8 seconds of silence before responding
  }

  private async processUserInput(text: string) {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.currentTranscript = '';

    this.addToConversationHistory('user', text);

    if (this.verificationData.state === 'VERIFYING') {
      this.verificationData = await handleVerificationAttempt(
        { log: this.log, verifier: this.verifier, recorder: this.recorder, propertyContext: this.propertyContext, fromPhone: this.fromPhone },
        text,
        this.verificationData
      );
      if (this.verificationData.tenantContext) {
        this.tenantContext = this.verificationData.tenantContext;
      }
    }

    try {
      const systemPrompt = buildSystemPrompt({
        propertyContext: this.propertyContext,
        tenantContext: this.tenantContext,
        verificationState: this.verificationData.state,
        claimedName: this.verificationData.claimedName,
        claimedUnit: this.verificationData.claimedUnit,
      });

      let fullResponse = '';
      this.log.startTimer('llm_response');

      await streamLLMResponse({
        sessionId: this.log.sessionId,
        systemPrompt,
        messages: this.conversationHistory as Array<{ role: 'user' | 'assistant'; content: string }>,
        onToken: async (token) => {
          fullResponse += token;
          if (this.audio) {
            this.audio.totalTTSCharacters += addTTSText(this.audio.tts, token);
          }
        },
        onDone: async (usage) => {
          this.log.infoWithLatency('llm_response', 'LLM response complete', { tokens: usage?.total_tokens });
          if (this.audio) flushTTS(this.audio.tts);

          // Parse response for control tags
          const parseResult = await parseResponse(
            {
              log: this.log,
              recorder: this.recorder,
              verifier: this.verifier,
              propertyContext: this.propertyContext,
              tenantContext: this.tenantContext,
              fromPhone: this.fromPhone,
            },
            fullResponse,
            this.verificationData,
            this.conversationHistory,
            this.issueData
          );
          this.shouldCreateTicket = parseResult.shouldCreateTicket;
          this.verificationData.createdUnverifiedRequest = parseResult.createdUnverifiedRequest;
          this.issueData = parseResult.issueData;
          if (parseResult.shouldEndCall) {
            setTimeout(() => this.end(), 2000);
          }

          const cleaned = cleanResponse(fullResponse);
          this.addToConversationHistory('assistant', cleaned);
          this.recorder.appendTranscript('ai', cleaned);

          // Start auto-end timer if response sounds like conversation is wrapping up
          const closingPhrases = ['anything else', 'have a good', 'take care', 'bye', 'goodbye', 'we\'ll get', 'we\'ll take care', 'someone will', 'is there anything'];
          const soundsLikeClosing = closingPhrases.some(phrase => cleaned.toLowerCase().includes(phrase));
          if (soundsLikeClosing) {
            if (this.autoEndTimer) clearTimeout(this.autoEndTimer);
            this.autoEndTimer = setTimeout(() => {
              this.log.info('Auto-ending call after silence (conversation complete)');
              this.end();
            }, 5000); // 5 seconds of silence after closing phrase
          }

          if (this.shouldCreateTicket) {
            const workOrderId = await handleTicketCreation(
              { log: this.log, recorder: this.recorder, verifier: this.verifier, propertyContext: this.propertyContext, tenantContext: this.tenantContext, fromPhone: this.fromPhone },
              this.conversationHistory
            );
            if (workOrderId) this.createdWorkOrderId = workOrderId;
            this.shouldCreateTicket = false;
          }
        },
      });
    } catch (error) {
      this.log.error('Error processing input', { error: (error as Error).message });
      const errorMsg = "I'm sorry, I'm having trouble. Could you repeat that?";
      if (this.audio) this.audio.totalTTSCharacters += speakText(this.audio.tts, errorMsg);
      this.recorder.appendTranscript('ai', errorMsg);
    } finally {
      this.isProcessing = false;
    }
  }

  async end() {
    // Clear auto-end timer
    if (this.autoEndTimer) {
      clearTimeout(this.autoEndTimer);
      this.autoEndTimer = null;
    }
    await handleEndSession(
      {
        log: this.log,
        recorder: this.recorder,
        verifier: this.verifier,
        propertyContext: this.propertyContext,
        tenantContext: this.tenantContext,
        fromPhone: this.fromPhone,
        toPhone: this.toPhone,
        callStartTime: this.callStartTime,
        audio: this.audio,
        silenceTimer: this.silenceTimer,
        durationTimers: this.durationTimers,
      },
      {
        verificationData: this.verificationData,
        conversationHistory: this.conversationHistory,
        issueData: this.issueData,
        createdWorkOrderId: this.createdWorkOrderId,
      }
    );
  }
}

// Re-export types for external consumers
export { VoiceSessionConfig } from './types.js';
