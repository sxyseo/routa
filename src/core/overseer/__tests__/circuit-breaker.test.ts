/**
 * Circuit Breaker unit tests.
 */
import { describe, it, expect } from "vitest";
import {
  createInMemoryOverseerStateStore,
} from "../overseer-state-store";
import { OverseerCircuitBreaker } from "../circuit-breaker";

describe("OverseerCircuitBreaker", () => {
  it("should be available initially", async () => {
    const store = createInMemoryOverseerStateStore();
    const cb = new OverseerCircuitBreaker(store);
    expect(await cb.isAvailable()).toBe(true);
  });

  it("should remain available after successes", async () => {
    const store = createInMemoryOverseerStateStore();
    const cb = new OverseerCircuitBreaker(store);
    await cb.recordSuccess();
    await cb.recordSuccess();
    expect(await cb.isAvailable()).toBe(true);
  });

  it("should open after 3 consecutive failures", async () => {
    const store = createInMemoryOverseerStateStore();
    const cb = new OverseerCircuitBreaker(store);
    await cb.recordFailure("error 1");
    expect(await cb.isAvailable()).toBe(true);
    await cb.recordFailure("error 2");
    expect(await cb.isAvailable()).toBe(true);
    await cb.recordFailure("error 3");
    expect(await cb.isAvailable()).toBe(false);
  });

  it("should reset failure count on success", async () => {
    const store = createInMemoryOverseerStateStore();
    const cb = new OverseerCircuitBreaker(store);
    await cb.recordFailure("error 1");
    await cb.recordFailure("error 2");
    await cb.recordSuccess();
    await cb.recordFailure("error 3");
    expect(await cb.isAvailable()).toBe(true); // failure count reset
  });

  it("should allow reset from open state", async () => {
    const store = createInMemoryOverseerStateStore();
    const cb = new OverseerCircuitBreaker(store);
    await cb.recordFailure("error 1");
    await cb.recordFailure("error 2");
    await cb.recordFailure("error 3");
    expect(await cb.isAvailable()).toBe(false);
    await cb.reset();
    expect(await cb.isAvailable()).toBe(true);
  });

  it("should expose state via getState", async () => {
    const store = createInMemoryOverseerStateStore();
    const cb = new OverseerCircuitBreaker(store);
    const state = await cb.getState();
    expect(state.consecutiveFailures).toBe(0);
    expect(state.isOpen).toBe(false);
  });
});
