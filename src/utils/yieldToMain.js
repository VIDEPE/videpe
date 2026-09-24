// Yields control back to the browser's event loop so a long synchronous loop (demuxing,
// filtering) doesn't block input/paint for its entire duration. Uses a macrotask
// (setTimeout), not a microtask (Promise.resolve()/queueMicrotask) — microtasks all drain
// before the next paint, so they never actually relieve a freeze; only a macrotask does.
export function yieldToMain() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
