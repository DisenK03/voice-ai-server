/**
 * Circuit Breaker Pattern
 *
 * Prevents cascading failures by failing fast when external services are down.
 *
 * States:
 * - CLOSED: Normal operation, requests go through
 * - OPEN: Service is down, requests fail immediately
 * - HALF_OPEN: Testing if service recovered
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold: number; // Failures before opening
  successThreshold: number; // Successes in half-open before closing
  timeout: number; // Time in ms before trying half-open
  onStateChange?: (name: string, from: CircuitState, to: CircuitState) => void;
  onFailure?: (name: string, error: Error) => void;
}

const DEFAULT_OPTIONS: Omit<CircuitBreakerOptions, 'name'> = {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 30000, // 30 seconds
};

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private options: CircuitBreakerOptions;

  constructor(options: CircuitBreakerOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  get currentState(): CircuitState {
    return this.state;
  }

  get stats() {
    return {
      name: this.options.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
    };
  }

  private transitionTo(newState: CircuitState) {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;

      if (this.options.onStateChange) {
        this.options.onStateChange(this.options.name, oldState, newState);
      }

      console.log(`[CircuitBreaker:${this.options.name}] ${oldState} → ${newState}`);
    }
  }

  private shouldAttemptReset(): boolean {
    return Date.now() - this.lastFailureTime >= this.options.timeout;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if we should try half-open
    if (this.state === 'OPEN' && this.shouldAttemptReset()) {
      this.transitionTo('HALF_OPEN');
      this.successes = 0;
    }

    // Fail fast if open
    if (this.state === 'OPEN') {
      throw new CircuitOpenError(this.options.name);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error as Error);
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;

    if (this.state === 'HALF_OPEN') {
      this.successes++;

      if (this.successes >= this.options.successThreshold) {
        this.transitionTo('CLOSED');
        this.successes = 0;
      }
    }
  }

  private onFailure(error: Error) {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.options.onFailure) {
      this.options.onFailure(this.options.name, error);
    }

    if (this.state === 'HALF_OPEN') {
      // Any failure in half-open goes back to open
      this.transitionTo('OPEN');
      this.successes = 0;
    } else if (this.failures >= this.options.failureThreshold) {
      this.transitionTo('OPEN');
    }
  }

  // Manually reset the circuit
  reset() {
    this.failures = 0;
    this.successes = 0;
    this.transitionTo('CLOSED');
  }
}

export class CircuitOpenError extends Error {
  constructor(circuitName: string) {
    super(`Circuit breaker '${circuitName}' is OPEN - service unavailable`);
    this.name = 'CircuitOpenError';
  }
}

// Global registry of circuit breakers
const circuits = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(name: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker {
  if (!circuits.has(name)) {
    circuits.set(
      name,
      new CircuitBreaker({
        name,
        ...DEFAULT_OPTIONS,
        ...options,
      })
    );
  }
  return circuits.get(name)!;
}

export function getAllCircuitStats() {
  return Array.from(circuits.values()).map((cb) => cb.stats);
}
