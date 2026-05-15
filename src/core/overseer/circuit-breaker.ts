/**
 * CircuitBreaker — self-protection for the overseer tick.
 *
 * After MAX_CONSECUTIVE_FAILURES consecutive tick failures, the breaker
 * opens and stops executing ticks. Only logs warnings until manually
 * or automatically reset.
 *
 * State is persisted via OverseerStateStore so it survives restarts.
 */

import type { OverseerStateStore, CircuitBreakerState } from "./overseer-state-store";

const MAX_CONSECUTIVE_FAILURES = 3;

export class OverseerCircuitBreaker {
  private state: CircuitBreakerState | null = null;

  constructor(private stateStore: OverseerStateStore) {}

  /**
   * Whether the breaker allows execution.
   */
  async isAvailable(): Promise<boolean> {
    await this.loadState();
    return !this.state!.isOpen;
  }

  /**
   * Record a successful tick execution.
   */
  async recordSuccess(): Promise<void> {
    await this.loadState();
    this.state!.consecutiveFailures = 0;
    this.state!.lastSuccessAt = Date.now();
    await this.persist();
  }

  /**
   * Record a failed tick execution.
   * Opens the breaker after MAX_CONSECUTIVE_FAILURES.
   */
  async recordFailure(error: string): Promise<void> {
    await this.loadState();
    this.state!.consecutiveFailures++;
    this.state!.lastFailureAt = Date.now();

    if (this.state!.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.state!.isOpen = true;
      console.error(
        `[Overseer] Circuit breaker OPENED after ${this.state!.consecutiveFailures} consecutive failures. ` +
        `Last error: ${error}. Overseer tick suspended until manual reset.`,
      );
    } else {
      console.warn(
        `[Overseer] Tick failed (${this.state!.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${error}`,
      );
    }

    await this.persist();
  }

  /**
   * Manually reset the breaker.
   */
  async reset(): Promise<void> {
    this.state = {
      consecutiveFailures: 0,
      lastFailureAt: null,
      isOpen: false,
      lastSuccessAt: Date.now(),
    };
    await this.persist();
    console.log("[Overseer] Circuit breaker reset.");
  }

  /**
   * Get current state for diagnostics.
   */
  async getState(): Promise<CircuitBreakerState> {
    await this.loadState();
    return { ...this.state! };
  }

  // ─── Internal ──────────────────────────────────────────────────────

  private async loadState(): Promise<void> {
    if (this.state) return;
    this.state = await this.stateStore.getCircuitBreakerState();
  }

  private async persist(): Promise<void> {
    await this.stateStore.setCircuitBreakerState(this.state!);
  }
}
