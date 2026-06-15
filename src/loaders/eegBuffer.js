import { useEffect, useRef, useState } from 'react';

// Number of window-sizes of margin kept loaded on each side of the visible window.
export const N_BUFFER_WINDOWS = 4;

// Debounces reload triggers so rapid navigation (scrubber drags, repeated
// Time-Step presses) doesn't spam getChunk; mirrors resizeDebounceRef in EegViewer.jsx.
const RELOAD_DEBOUNCE_MS = 150;

// Clamps value to the inclusive range [lo, hi].
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

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

  useEffect(() => {
    // If the provider changes, discard the old buffer and load a new one.
    const { tMax } = provider; // tMax in seconds
    const bufferStart = clamp(startTime - N_BUFFER_WINDOWS * windowSize, 0, tMax); // bufferStart in seconds
    const bufferEnd = clamp(startTime + windowSize + N_BUFFER_WINDOWS * windowSize, 0, tMax); // bufferEnd in seconds

    // Check if the buffer is initial (null or from a different provider)
    const isInitial = buffer === null || buffer.provider !== provider;
    // If the buffer is not initial, check if it covers the requested window.
    const marginLeft = isInitial ? 0 : startTime - buffer.bufferStart; // how much extra buffered data sits to the left of the current viewport
    const marginRight = isInitial ? 0 : buffer.bufferEnd - (startTime + windowSize); // how much extra buffered data sits to the right of the viewport
    // check if we have at least one full window of margin on each side of the viewport (or it is at the start/end)
    const covered =
      !isInitial &&
      (buffer.bufferStart === 0 || marginLeft >= windowSize) &&
      (buffer.bufferEnd === tMax || marginRight >= windowSize);

    if (covered) return undefined;

    // If we get here, we need to load a new buffer.

    // Increment the requestId so that any previous load requests are ignored when they resolve.
    // Why it's needed: if the user scrolls quickly, a new effect run can fire a second getChunk call before the first resolves. Without this guard, whichever promise resolves last wins
    const requestId = ++requestIdRef.current;

    // Async function to load the buffer data and update state when it arrives. It checks requestIdRef to ensure that only the most recent request can update state.
    const load = async () => {
      const { timestamps, channels } = await provider.getChunk(bufferStart, bufferEnd);
      if (requestIdRef.current !== requestId) return; // superseded by a newer request
      setBuffer({ provider, bufferStart, bufferEnd, timestamps, channels });
      setIsLoading(false);
    };

    // If this is the first load, do it immediately.
    if (isInitial) {
      setIsLoading(true);
      load();
      return undefined;
    }
    // Else debounce the load to avoid spamming getChunk during rapid navigation.
    const timer = setTimeout(load, RELOAD_DEBOUNCE_MS); // schedules load to be invoked after RELOAD_DEBOUNCE_MS (150ms) delay
    return () => clearTimeout(timer); // cleanup function to cancel the scheduled load if the effect is re-run before the timer fires
  }, [provider, startTime, windowSize, buffer]);

  // Return the current buffer data and loading state. If a load is in flight, the previous buffer's data is returned until the new buffer resolves.
  return {
    timestamps: buffer?.timestamps ?? null,
    channels: buffer?.channels ?? null,
    isLoading,
  };
}
