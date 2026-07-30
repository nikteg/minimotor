/** Run `fn` every `intervalMs` on a wall clock. Returns a stop function.
 *
 *  Deliberately NOT driven by the engine's frame loop or its pause state:
 *
 *  1. Frame pacing is not send pacing. The fixed-step accumulator runs zero
 *     steps in one frame and two in the next, so step-driven sends leave in
 *     bursts — two snapshots 1 ms apart, then a 33 ms gap. Receivers have to
 *     undo that, and anything measuring the network by arrival gaps reads the
 *     burst as real motion.
 *  2. `requestAnimationFrame` stops when the page is hidden, which silently
 *     stops a peer from transmitting at all. A timer is throttled when hidden
 *     too, but it keeps ticking, so the peer stays present rather than looking
 *     frozen to everyone else.
 *  3. Pausing is a decision about YOUR clock, not about your presence in
 *     someone else's room. A paused player still occupies the world, and a
 *     peer that goes quiet is pruned from every roster after `timeoutMs` — so
 *     freezing replication on pause makes them disappear rather than stand
 *     still. The sampler reads the frozen body and everyone sees exactly that. */
export function everyMs(intervalMs: number, fn: () => void): () => void {
  const timer = setInterval(fn, Math.max(1, intervalMs));
  return () => clearInterval(timer);
}
