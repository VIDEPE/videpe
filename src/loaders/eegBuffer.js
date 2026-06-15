import { useEffect, useRef, useState } from 'react';

// Number of window-sizes of margin kept loaded on each side of the visible window.
export const N_BUFFER_WINDOWS = 15;

// Reload triggers once the remaining margin on a side drops below this
// fraction of the buffer's actual margin (must be < N_BUFFER_WINDOWS,
// leaving room to reload before the buffer runs out).
export const RELOAD_MARGIN_WINDOWS = 5;

// Each channel's getChunk result is a Float32Array.
export const BYTES_PER_SAMPLE = 4;

// Caps total buffered duration so a large windowSize on a
// high-channel-count/high-fs recording can't balloon memory usage. ~256MB
// per buffer (briefly ~2x during a reload, before the old buffer is dropped).
// Note: the current displayed window is always loaded, even if it alone exceeds this budget,
// it just means the buffer will be empty and any time shift will trigger a reload.
export const MAX_BUFFER_BYTES = 128 * 1024 * 1024;

// Fraction of the buffer margin that must remain before a reload triggers.
// Expressing it as a fraction (rather than RELOAD_MARGIN_WINDOWS * windowSize
// directly) keeps the threshold proportional even when the margin is capped
// below N_BUFFER_WINDOWS * windowSize by MAX_BUFFER_BYTES — otherwise the
// threshold could exceed the actual margin and `covered` would never be true.
const RELOAD_MARGIN_FRACTION = RELOAD_MARGIN_WINDOWS / N_BUFFER_WINDOWS;

// Throttle interval for reload triggers — see the `pendingTimerRef` comment below.
const RELOAD_DEBOUNCE_MS = 150;

// Clamps value to the inclusive range [lo, hi].
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

// Margin (seconds) kept loaded on each side of the visible window, capped so
// the total buffered span (windowSize + 2*margin) stays within
// MAX_BUFFER_BYTES for this recording's channel count and sample rate. Floors
// at 0 — the visible window itself is always loaded, even if it alone exceeds
// the budget.
const computeMargin = (provider, windowSize) => {
  const desiredMargin = N_BUFFER_WINDOWS * windowSize;
  const maxTotalSeconds =
    MAX_BUFFER_BYTES / (BYTES_PER_SAMPLE * provider.fs * provider.channelNames.length);
  const maxMargin = Math.max(0, (maxTotalSeconds - windowSize) / 2);
  return Math.min(desiredMargin, maxMargin);
};

/**
 * Loads and maintains a buffer of EEG data around the currently visible
 * window, so navigation within the buffer doesn't require reloading.
 *
 * Returns `{ timestamps, channels, isLoading }`. `timestamps`/`channels`
 * remain the previous buffer's data while a reload is in flight, and are
 * swapped atomically once the new buffer resolves — there is no
 * intermediate empty/cleared state, avoiding a flash on screen.
 * `isLoading` is only true before the first buffer has ever arrived.
 */
export function useEegBuffer(provider, startTime, windowSize) {
  const [buffer, setBuffer] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const requestIdRef = useRef(0);
  // Throttle (not debounce): at most one pending reload timer. A plain
  // debounce can starve under sustained rapid navigation (e.g. holding
  // Time-Step) — the timer keeps getting cancelled/rescheduled and never
  // fires, so the buffer never refills and the plot goes empty.
  const pendingTimerRef = useRef(null);
  // Always-current params, read by a pending timer when it eventually fires
  // so the reload targets where the user IS, not where they were when the
  // timer was scheduled.
  const latestRef = useRef({ provider, startTime, windowSize });
  useEffect(() => {
    latestRef.current = { provider, startTime, windowSize };
  }, [provider, startTime, windowSize]);

  useEffect(() => {
    // If the provider changes, discard the old buffer and load a new one.
    const { tMax } = provider; // tMax in seconds

    // Check if the buffer is initial (null or from a different provider)
    const isInitial = buffer === null || buffer.provider !== provider;
    // If the buffer is not initial, check if it covers the requested window.
    const marginLeft = isInitial ? 0 : startTime - buffer.bufferStart; // how much extra buffered data sits to the left of the current viewport
    const marginRight = isInitial ? 0 : buffer.bufferEnd - (startTime + windowSize); // how much extra buffered data sits to the right of the viewport
    // check if at least RELOAD_MARGIN_FRACTION of the buffer's margin remains on each side (or it is at the start/end)
    const reloadThreshold = isInitial ? 0 : buffer.margin * RELOAD_MARGIN_FRACTION;
    const covered =
      !isInitial &&
      (buffer.bufferStart === 0 || marginLeft >= reloadThreshold) &&
      (buffer.bufferEnd === tMax || marginRight >= reloadThreshold);

    if (covered) return undefined;

    // If we get here, we need to load a new buffer.

    // Loads the buffer spanning the *latest* known startTime/windowSize/provider
    // (not necessarily the values from the effect run that scheduled this), and
    // updates state when it arrives. Checks requestIdRef so only the most
    // recent request can update state.
    const load = () => {
      pendingTimerRef.current = null;

      const current = latestRef.current;
      const { tMax: currentTMax } = current.provider;
      const margin = computeMargin(current.provider, current.windowSize);
      const start = clamp(current.startTime - margin, 0, currentTMax);
      const end = clamp(current.startTime + current.windowSize + margin, 0, currentTMax);

      // Increment the requestId so that any previous load requests are ignored when they resolve.
      // Why it's needed: if the user scrolls quickly, a new request can fire before an earlier one resolves. Without this guard, whichever promise resolves last wins
      const requestId = ++requestIdRef.current;

      current.provider.getChunk(start, end).then(({ timestamps, channels }) => {
        if (requestIdRef.current !== requestId) return; // superseded by a newer request

        setBuffer({
          provider: current.provider,
          bufferStart: start,
          bufferEnd: end,
          margin,
          timestamps,
          channels,
        });
        setIsLoading(false);
      });
    };

    // If this is the first load, do it immediately. Also clear any pending
    // throttled reload left over from a previous provider — it would
    // otherwise still fire later, targeting the new provider via latestRef
    // (redundant once this immediate load completes).
    if (isInitial) {
      if (pendingTimerRef.current !== null) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      setIsLoading(true);
      load();
      return undefined;
    }

    // Otherwise, throttle: only schedule a reload if one isn't already pending.
    if (pendingTimerRef.current === null) {
      pendingTimerRef.current = setTimeout(load, RELOAD_DEBOUNCE_MS);
    }
    return undefined;
  }, [provider, startTime, windowSize, buffer]);

  // Clear any pending reload timer on unmount.
  useEffect(() => {
    return () => {
      if (pendingTimerRef.current !== null) clearTimeout(pendingTimerRef.current);
    };
  }, []);

  // Return the current buffer data and loading state. If a load is in flight, the previous buffer's data is returned until the new buffer resolves.
  return {
    timestamps: buffer?.timestamps ?? null,
    channels: buffer?.channels ?? null,
    isLoading,
  };
}
