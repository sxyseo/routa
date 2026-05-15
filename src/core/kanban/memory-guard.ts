/**
 * Memory Guard
 *
 * Checks if the Node.js process is approaching its heap limit and returns
 * true when background ticks (LaneScanner, Watchdog) should be skipped to
 * avoid OOM crashes. Uses `process.memoryUsage()` to sample RSS and heap.
 */

const DEFAULT_HEAP_LIMIT_MB = 4096;
const SKIP_THRESHOLD_RATIO = 0.85;

export function shouldSkipTickForMemory(label: string): boolean {
  const mem = process.memoryUsage();
  const limitMb = parseInt(process.env.ROUTA_MEMORY_LIMIT_MB ?? `${DEFAULT_HEAP_LIMIT_MB}`, 10);
  const heapUsedMb = mem.heapUsed / (1024 * 1024);
  if (heapUsedMb > limitMb * SKIP_THRESHOLD_RATIO) {
    console.warn(
      `[MemoryGuard] ${label}: heap ${heapUsedMb.toFixed(0)}MB / ${limitMb}MB — skipping tick`,
    );
    return true;
  }
  return false;
}
