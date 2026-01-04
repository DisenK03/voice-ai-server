/**
 * Prometheus Metrics Registry
 *
 * Provides metrics collection and export in Prometheus format.
 * Supports counters, gauges, and histograms for voice server monitoring.
 */

// Metric types
type MetricType = 'counter' | 'gauge' | 'histogram';

interface MetricDefinition {
  name: string;
  help: string;
  type: MetricType;
  labels?: string[];
}

interface MetricValue {
  value: number;
  labels: Record<string, string>;
  timestamp?: number;
}

interface HistogramBucket {
  le: number;
  count: number;
}

interface HistogramValue {
  buckets: HistogramBucket[];
  sum: number;
  count: number;
  labels: Record<string, string>;
}

// Default histogram buckets (in milliseconds)
const DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

/**
 * Prometheus Metrics Registry
 */
class MetricsRegistry {
  private counters = new Map<string, MetricValue[]>();
  private gauges = new Map<string, MetricValue[]>();
  private histograms = new Map<string, HistogramValue[]>();
  private definitions = new Map<string, MetricDefinition>();
  private histogramBuckets = new Map<string, number[]>();

  /**
   * Register a new metric
   */
  register(definition: MetricDefinition, buckets?: number[]): void {
    this.definitions.set(definition.name, definition);

    if (definition.type === 'histogram') {
      this.histogramBuckets.set(definition.name, buckets || DEFAULT_BUCKETS);
    }
  }

  /**
   * Increment a counter
   */
  incCounter(name: string, labels: Record<string, string> = {}, value = 1): void {
    const existing = this.findMetricValue(this.counters, name, labels);
    if (existing) {
      existing.value += value;
    } else {
      this.addMetricValue(this.counters, name, { value, labels });
    }
  }

  /**
   * Set a gauge value
   */
  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const existing = this.findMetricValue(this.gauges, name, labels);
    if (existing) {
      existing.value = value;
    } else {
      this.addMetricValue(this.gauges, name, { value, labels });
    }
  }

  /**
   * Increment a gauge
   */
  incGauge(name: string, labels: Record<string, string> = {}, value = 1): void {
    const existing = this.findMetricValue(this.gauges, name, labels);
    if (existing) {
      existing.value += value;
    } else {
      this.addMetricValue(this.gauges, name, { value, labels });
    }
  }

  /**
   * Decrement a gauge
   */
  decGauge(name: string, labels: Record<string, string> = {}, value = 1): void {
    const existing = this.findMetricValue(this.gauges, name, labels);
    if (existing) {
      existing.value -= value;
    } else {
      this.addMetricValue(this.gauges, name, { value: -value, labels });
    }
  }

  /**
   * Observe a histogram value
   */
  observeHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const buckets = this.histogramBuckets.get(name) || DEFAULT_BUCKETS;
    const existing = this.findHistogramValue(name, labels);

    if (existing) {
      existing.sum += value;
      existing.count += 1;
      for (const bucket of existing.buckets) {
        if (value <= bucket.le) {
          bucket.count += 1;
        }
      }
    } else {
      const histogramValue: HistogramValue = {
        sum: value,
        count: 1,
        labels,
        buckets: buckets.map((le) => ({
          le,
          count: value <= le ? 1 : 0,
        })),
      };
      this.addHistogramValue(name, histogramValue);
    }
  }

  /**
   * Export all metrics in Prometheus format
   */
  export(): string {
    const lines: string[] = [];

    // Export counters
    for (const [name, values] of this.counters) {
      const def = this.definitions.get(name);
      if (def) {
        lines.push(`# HELP ${name} ${def.help}`);
        lines.push(`# TYPE ${name} counter`);
      }
      for (const metric of values) {
        lines.push(this.formatMetricLine(name, metric.value, metric.labels));
      }
    }

    // Export gauges
    for (const [name, values] of this.gauges) {
      const def = this.definitions.get(name);
      if (def) {
        lines.push(`# HELP ${name} ${def.help}`);
        lines.push(`# TYPE ${name} gauge`);
      }
      for (const metric of values) {
        lines.push(this.formatMetricLine(name, metric.value, metric.labels));
      }
    }

    // Export histograms
    for (const [name, values] of this.histograms) {
      const def = this.definitions.get(name);
      if (def) {
        lines.push(`# HELP ${name} ${def.help}`);
        lines.push(`# TYPE ${name} histogram`);
      }
      for (const hist of values) {
        for (const bucket of hist.buckets) {
          const bucketLabels = { ...hist.labels, le: String(bucket.le) };
          lines.push(this.formatMetricLine(`${name}_bucket`, bucket.count, bucketLabels));
        }
        const infLabels = { ...hist.labels, le: '+Inf' };
        lines.push(this.formatMetricLine(`${name}_bucket`, hist.count, infLabels));
        lines.push(this.formatMetricLine(`${name}_sum`, hist.sum, hist.labels));
        lines.push(this.formatMetricLine(`${name}_count`, hist.count, hist.labels));
      }
    }

    return lines.join('\n');
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }

  private formatMetricLine(name: string, value: number, labels: Record<string, string>): string {
    const labelPairs = Object.entries(labels)
      .map(([k, v]) => `${k}="${this.escapeLabel(v)}"`)
      .join(',');

    if (labelPairs) {
      return `${name}{${labelPairs}} ${value}`;
    }
    return `${name} ${value}`;
  }

  private escapeLabel(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  private findMetricValue(
    map: Map<string, MetricValue[]>,
    name: string,
    labels: Record<string, string>
  ): MetricValue | undefined {
    const values = map.get(name);
    if (!values) return undefined;
    return values.find((v) => this.labelsMatch(v.labels, labels));
  }

  private addMetricValue(map: Map<string, MetricValue[]>, name: string, metric: MetricValue): void {
    if (!map.has(name)) {
      map.set(name, []);
    }
    map.get(name)!.push(metric);
  }

  private findHistogramValue(name: string, labels: Record<string, string>): HistogramValue | undefined {
    const values = this.histograms.get(name);
    if (!values) return undefined;
    return values.find((v) => this.labelsMatch(v.labels, labels));
  }

  private addHistogramValue(name: string, hist: HistogramValue): void {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, []);
    }
    this.histograms.get(name)!.push(hist);
  }

  private labelsMatch(a: Record<string, string>, b: Record<string, string>): boolean {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k) => a[k] === b[k]);
  }
}

// Create singleton registry
export const metrics = new MetricsRegistry();
