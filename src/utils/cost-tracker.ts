/**
 * API Cost Tracker
 *
 * Tracks estimated costs per API call for budget monitoring.
 * Logs to console and can be extended to send to analytics.
 */

export interface CostEntry {
  service: string;
  operation: string;
  units: number; // Characters, tokens, minutes, etc.
  unitType: string;
  estimatedCost: number;
  sessionId: string;
  timestamp: number;
}

// Pricing (as of 2024 - update as needed)
const PRICING = {
  elevenlabs: {
    charactersPerDollar: 10000, // ~$0.0001 per character (Starter plan)
    model: 'eleven_turbo_v2_5',
  },
  deepgram: {
    perMinute: 0.0043, // Nova-2 streaming
    model: 'nova-2',
  },
  openai: {
    // GPT-4o-mini pricing
    inputPerMillion: 0.15, // $0.15 per 1M input tokens
    outputPerMillion: 0.6, // $0.60 per 1M output tokens
    model: 'gpt-4o-mini',
  },
  twilio: {
    voicePerMinute: 0.014, // Inbound voice
    smsPerSegment: 0.0079,
  },
};

class CostTracker {
  private entries: CostEntry[] = [];
  private sessionCosts = new Map<string, number>();

  /**
   * Track ElevenLabs TTS cost
   */
  trackElevenLabs(sessionId: string, characters: number): CostEntry {
    const cost = characters / PRICING.elevenlabs.charactersPerDollar;
    return this.addEntry({
      service: 'elevenlabs',
      operation: 'tts',
      units: characters,
      unitType: 'characters',
      estimatedCost: cost,
      sessionId,
      timestamp: Date.now(),
    });
  }

  /**
   * Track Deepgram STT cost
   */
  trackDeepgram(sessionId: string, durationMs: number): CostEntry {
    const minutes = durationMs / 60000;
    const cost = minutes * PRICING.deepgram.perMinute;
    return this.addEntry({
      service: 'deepgram',
      operation: 'stt',
      units: Math.round(durationMs),
      unitType: 'ms',
      estimatedCost: cost,
      sessionId,
      timestamp: Date.now(),
    });
  }

  /**
   * Track OpenAI cost
   */
  trackOpenAI(sessionId: string, inputTokens: number, outputTokens: number): CostEntry {
    const inputCost = (inputTokens / 1_000_000) * PRICING.openai.inputPerMillion;
    const outputCost = (outputTokens / 1_000_000) * PRICING.openai.outputPerMillion;
    const totalCost = inputCost + outputCost;

    return this.addEntry({
      service: 'openai',
      operation: 'chat',
      units: inputTokens + outputTokens,
      unitType: 'tokens',
      estimatedCost: totalCost,
      sessionId,
      timestamp: Date.now(),
    });
  }

  /**
   * Track Twilio voice cost
   */
  trackTwilioVoice(sessionId: string, durationMs: number): CostEntry {
    const minutes = durationMs / 60000;
    const cost = minutes * PRICING.twilio.voicePerMinute;
    return this.addEntry({
      service: 'twilio',
      operation: 'voice',
      units: Math.round(durationMs),
      unitType: 'ms',
      estimatedCost: cost,
      sessionId,
      timestamp: Date.now(),
    });
  }

  private addEntry(entry: CostEntry): CostEntry {
    this.entries.push(entry);

    // Update session totals
    const currentTotal = this.sessionCosts.get(entry.sessionId) || 0;
    this.sessionCosts.set(entry.sessionId, currentTotal + entry.estimatedCost);

    // Log the cost
    console.log(
      `[Cost:${entry.sessionId.slice(0, 8)}] ${entry.service}/${entry.operation}: ` +
        `${entry.units} ${entry.unitType} = $${entry.estimatedCost.toFixed(6)}`
    );

    return entry;
  }

  /**
   * Get total cost for a session
   */
  getSessionCost(sessionId: string): number {
    return this.sessionCosts.get(sessionId) || 0;
  }

  /**
   * Get all entries for a session
   */
  getSessionEntries(sessionId: string): CostEntry[] {
    return this.entries.filter((e) => e.sessionId === sessionId);
  }

  /**
   * Log session summary
   */
  logSessionSummary(sessionId: string): void {
    const entries = this.getSessionEntries(sessionId);
    const total = this.getSessionCost(sessionId);

    const byService = entries.reduce(
      (acc, e) => {
        acc[e.service] = (acc[e.service] || 0) + e.estimatedCost;
        return acc;
      },
      {} as Record<string, number>
    );

    console.log(`\n[Cost Summary:${sessionId.slice(0, 8)}]`);
    console.log('─'.repeat(40));
    Object.entries(byService).forEach(([service, cost]) => {
      console.log(`  ${service.padEnd(15)} $${cost.toFixed(6)}`);
    });
    console.log('─'.repeat(40));
    console.log(`  ${'TOTAL'.padEnd(15)} $${total.toFixed(6)}`);
    console.log('');
  }

  /**
   * Get aggregate stats
   */
  getStats() {
    const totalCost = Array.from(this.sessionCosts.values()).reduce((a, b) => a + b, 0);
    const totalSessions = this.sessionCosts.size;
    const avgCostPerSession = totalSessions > 0 ? totalCost / totalSessions : 0;

    return {
      totalCost,
      totalSessions,
      avgCostPerSession,
      entriesCount: this.entries.length,
    };
  }

  /**
   * Clear old entries (keep last N hours)
   */
  cleanup(hoursToKeep = 24) {
    const cutoff = Date.now() - hoursToKeep * 60 * 60 * 1000;
    this.entries = this.entries.filter((e) => e.timestamp > cutoff);
  }
}

// Singleton instance
export const costTracker = new CostTracker();

// Expose pricing for reference
export { PRICING };
