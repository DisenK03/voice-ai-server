/**
 * OpenAI Streaming LLM
 *
 * Streams GPT-4o responses token by token for minimal latency.
 * Each token is immediately forwarded to TTS.
 *
 * Includes: circuit breaker, retry logic, cost tracking
 */

import { config } from 'dotenv';
import OpenAI from 'openai';
import { getCircuitBreaker, withRetry, costTracker } from './utils/index.js';

config();

let openai: OpenAI;

function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || '',
    });
  }
  return openai;
}

// Timeout for streaming responses to prevent indefinite hangs
const STREAM_TIMEOUT_MS = 30000; // 30 seconds

interface StreamLLMConfig {
  sessionId?: string;
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  onToken: (token: string) => void;
  onDone: (usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) => void;
}

// Circuit breaker for OpenAI
const openaiCircuit = getCircuitBreaker('openai', {
  failureThreshold: 3,
  successThreshold: 2,
  timeout: 30000, // 30 seconds before retry
  onStateChange: (name, from, to) => {
    console.log(`[OpenAI Circuit] ${from} → ${to}`);
  },
});

export async function streamLLMResponse(config: StreamLLMConfig): Promise<void> {
  const sessionId = config.sessionId || 'unknown';

  // Use circuit breaker to protect against repeated failures
  return openaiCircuit.execute(async () => {
    return withRetry(
      async () => streamLLMWithTracking(config, sessionId),
      {
        maxRetries: 2,
        baseDelayMs: 500,
        retryableErrors: ['429', '500', '502', '503', '504', 'timeout', 'ECONNRESET'],
        onRetry: (attempt, error, delayMs) => {
          console.log(`[OpenAI:${sessionId.slice(0, 8)}] Retry ${attempt} after ${delayMs}ms: ${error.message}`);
        },
      }
    );
  });
}

async function streamLLMWithTracking(config: StreamLLMConfig, sessionId: string): Promise<void> {
  const { systemPrompt, messages, onToken, onDone } = config;

  // Estimate input tokens (rough: ~4 chars per token)
  const inputText = systemPrompt + messages.map((m) => m.content).join(' ');
  const estimatedInputTokens = Math.ceil(inputText.length / 4);
  let outputTokens = 0;

  // Create AbortController with timeout to prevent indefinite hangs
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, STREAM_TIMEOUT_MS);

  try {
    const stream = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini', // Faster than gpt-4o, still very capable
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ],
      max_tokens: 150, // Keep responses short for voice
      temperature: 0.7,
      stream: true,
      stream_options: { include_usage: true },
    }, {
      signal: controller.signal,
    });

    let usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content || '';
      if (token) {
        onToken(token);
        outputTokens++;
      }

      // Capture usage from final chunk
      if (chunk.usage) {
        usage = {
          prompt_tokens: chunk.usage.prompt_tokens,
          completion_tokens: chunk.usage.completion_tokens,
          total_tokens: chunk.usage.total_tokens,
        };
      }
    }

    // Track cost
    const finalInputTokens = usage?.prompt_tokens || estimatedInputTokens;
    const finalOutputTokens = usage?.completion_tokens || outputTokens;
    costTracker.trackOpenAI(sessionId, finalInputTokens, finalOutputTokens);

    onDone(usage);
  } catch (error) {
    // Handle abort specifically
    if (error instanceof Error && error.name === 'AbortError') {
      console.error(`[OpenAI:${sessionId.slice(0, 8)}] Stream timed out after ${STREAM_TIMEOUT_MS}ms`);
      throw new Error('LLM response timeout');
    }
    console.error(`[OpenAI:${sessionId.slice(0, 8)}] Streaming error:`, error);
    throw error;
  } finally {
    // Always clear the timeout to prevent memory leaks
    clearTimeout(timeoutId);
  }
}

// Export circuit stats for health endpoint
export function getOpenAICircuitStats() {
  return openaiCircuit.stats;
}
