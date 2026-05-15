/**
 * Next.js Instrumentation (Edge Runtime entry)
 *
 * This file is loaded by BOTH Edge and Node.js runtimes.
 * It intentionally contains no Node.js-only imports so the Edge Runtime
 * bundler never traces modules like `fs`, `path`, `url`, etc.
 *
 * All Node.js-specific startup/shutdown logic lives in
 * `instrumentation.node.ts`, which Next.js only loads when
 * `NEXT_RUNTIME === "nodejs"`.
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Node.js runtime: instrumentation.node.ts takes precedence.
  // Edge runtime: nothing to do.
}

export async function unregister() {
  // Node.js runtime: instrumentation.node.ts takes precedence.
  // Edge runtime: nothing to do.
}
