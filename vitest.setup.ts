import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Mock React.startTransition for environments that don't have it
if (typeof (globalThis as Record<string, unknown>).startTransition === "undefined") {
  (globalThis as Record<string, unknown>).startTransition = (fn: () => void) => fn();
}

// Mock React.useTransition for environments that don't have it
if (typeof (globalThis as Record<string, unknown>).useTransition === "undefined") {
  (globalThis as Record<string, unknown>).useTransition = () => [
    () => {},
    false,
  ] as [() => void, boolean];
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Cleanup after each test
afterEach(() => {
  cleanup();
});
