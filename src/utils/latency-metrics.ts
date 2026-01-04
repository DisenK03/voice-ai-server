/**
 * Latency Metrics Collection
 *
 * Tracks operation latencies with statistical analysis.
 */

export interface LatencyStats {
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

/**
 * Latency metrics collection for a session
 */
export class LatencyMetrics {
  private sessionId: string;
  private measurements: Map<string, number[]> = new Map();

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  record(operation: string, latencyMs: number): void {
    if (!this.measurements.has(operation)) {
      this.measurements.set(operation, []);
    }
    this.measurements.get(operation)!.push(latencyMs);
  }

  getStats(operation: string): LatencyStats | null {
    const values = this.measurements.get(operation) || [];
    if (values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    return {
      count: values.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }

  getAllStats(): Record<string, LatencyStats | null> {
    const stats: Record<string, LatencyStats | null> = {};
    for (const [op] of this.measurements) {
      stats[op] = this.getStats(op);
    }
    return stats;
  }

  logSummary(): void {
    console.log(`\n[Latency Summary:${this.sessionId.slice(0, 8)}]`);
    console.log('─'.repeat(60));
    console.log('Operation'.padEnd(20) + 'Count'.padEnd(8) + 'Avg'.padEnd(10) + 'P95'.padEnd(10) + 'Max');
    console.log('─'.repeat(60));

    for (const [op] of this.measurements) {
      const stats = this.getStats(op);
      if (stats) {
        console.log(
          op.padEnd(20) +
            String(stats.count).padEnd(8) +
            `${stats.avg}ms`.padEnd(10) +
            `${stats.p95}ms`.padEnd(10) +
            `${stats.max}ms`
        );
      }
    }
    console.log('');
  }
}
