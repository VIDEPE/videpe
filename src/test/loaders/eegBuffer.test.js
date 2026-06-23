import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useEegBuffer,
  N_BUFFER_WINDOWS,
  RELOAD_MARGIN_WINDOWS,
  MAX_BUFFER_BYTES,
  BYTES_PER_SAMPLE,
} from '@/loaders/eegBuffer';

const RELOAD_DEBOUNCE_MS = 150;
const WINDOW_SIZE = 20;
const BUFFER_MARGIN = N_BUFFER_WINDOWS * WINDOW_SIZE; // 300
const RELOAD_THRESHOLD = RELOAD_MARGIN_WINDOWS * WINDOW_SIZE; // 100

const makeChunk = (start, end) => ({
  timestamps: new Float32Array([start, end]),
  channels: [new Float32Array([start, end])],
});

// Default fs/channelNames give a huge memory-budget margin (~131k seconds),
// far above anything these tests need, so MAX_BUFFER_BYTES never caps them
// unless a test explicitly overrides fs/channelNames to trigger the cap.
const makeProvider = (tMax, { fs = 256, channelNames = ['Ch1'] } = {}) => ({
  tMax,
  fs,
  channelNames,
  getChunk: vi.fn((start, end) => Promise.resolve(makeChunk(start, end))),
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useEegBuffer — initial load', () => {
  it('loads a buffer spanning (1 + 2*N_BUFFER_WINDOWS) * windowSize, centered on the window', async () => {
    const provider = makeProvider(10000);
    const windowSize = 20;
    const startTime = 500;
    const { result } = renderHook(() => useEegBuffer(provider, startTime, windowSize));

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const expectedStart = startTime - N_BUFFER_WINDOWS * windowSize;
    const expectedEnd = startTime + windowSize + N_BUFFER_WINDOWS * windowSize;
    expect(provider.getChunk).toHaveBeenCalledTimes(1);
    expect(provider.getChunk).toHaveBeenCalledWith(expectedStart, expectedEnd);
    expect(result.current.timestamps).not.toBeNull();
    expect(result.current.channels).not.toBeNull();
  });

  it('clamps the buffer to [0, tMax] near the start of the recording', async () => {
    const provider = makeProvider(100);
    const { result } = renderHook(() => useEegBuffer(provider, 0, 20));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // bufferStart = clamp(0 - N_BUFFER_WINDOWS*20, 0, 100) = 0, bufferEnd = clamp(0 + 20 + N_BUFFER_WINDOWS*20, 0, 100) = 100
    expect(provider.getChunk).toHaveBeenCalledWith(0, 100);
  });

  it('clamps the buffer to [0, tMax] near the end of the recording', async () => {
    const provider = makeProvider(100);
    const { result } = renderHook(() => useEegBuffer(provider, 80, 20)); // window = [80, 100]
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // bufferStart = clamp(80 - N_BUFFER_WINDOWS*20, 0, 100) = 0, bufferEnd = clamp(80 + 20 + N_BUFFER_WINDOWS*20, 0, 100) = 100
    expect(provider.getChunk).toHaveBeenCalledWith(0, 100);
  });
});

describe('useEegBuffer — reload triggers', () => {
  // Large tMax/startTime so the buffer span (BUFFER_MARGIN on each side) and
  // any recentering never clamp against 0 or tMax — keeps the arithmetic
  // below independent of clamping edge cases.
  const TMAX = 100000;
  const START = 50000;
  const BUFFER_START = START - BUFFER_MARGIN;

  it('does not refetch for small startTime changes within the buffer margin', async () => {
    const provider = makeProvider(TMAX);
    const { result, rerender } = renderHook(
      ({ startTime, windowSize }) => useEegBuffer(provider, startTime, windowSize),
      { initialProps: { startTime: START, windowSize: WINDOW_SIZE } }
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // buffer = [BUFFER_START, BUFFER_START + (1+2N)*windowSize]; a small shift
    // still leaves >= RELOAD_THRESHOLD margin on both sides
    rerender({ startTime: START + 10, windowSize: WINDOW_SIZE });
    await act(async () => {});

    expect(provider.getChunk).toHaveBeenCalledTimes(1);
  });

  it('refetches with a recentered buffer once the margin drops below RELOAD_THRESHOLD', async () => {
    vi.useFakeTimers();
    const provider = makeProvider(TMAX);
    const { result, rerender } = renderHook(
      ({ startTime, windowSize }) => useEegBuffer(provider, startTime, windowSize),
      { initialProps: { startTime: START, windowSize: WINDOW_SIZE } }
    );
    // initial load resolves via microtask, not a timer — flush it
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.isLoading).toBe(false);

    // marginLeft = newStart - BUFFER_START = RELOAD_THRESHOLD - 10 < RELOAD_THRESHOLD
    const newStart = BUFFER_START + RELOAD_THRESHOLD - 10;
    rerender({ startTime: newStart, windowSize: WINDOW_SIZE });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS);
    });

    expect(provider.getChunk).toHaveBeenCalledTimes(2);
    // recentered around newStart
    expect(provider.getChunk).toHaveBeenLastCalledWith(
      newStart - BUFFER_MARGIN,
      newStart + WINDOW_SIZE + BUFFER_MARGIN
    );
  });

  it('throttles rapid successive startTime changes into a single refetch', async () => {
    vi.useFakeTimers();
    const provider = makeProvider(TMAX);
    const { result, rerender } = renderHook(
      ({ startTime, windowSize }) => useEegBuffer(provider, startTime, windowSize),
      { initialProps: { startTime: START, windowSize: WINDOW_SIZE } }
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.isLoading).toBe(false);

    // All three values leave marginLeft < RELOAD_THRESHOLD, so each rerender
    // is "not covered" — but only one reload should be scheduled.
    const lastStart = BUFFER_START + RELOAD_THRESHOLD - 12;
    rerender({ startTime: lastStart + 2, windowSize: WINDOW_SIZE });
    rerender({ startTime: lastStart + 1, windowSize: WINDOW_SIZE });
    rerender({ startTime: lastStart, windowSize: WINDOW_SIZE });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS);
    });

    expect(provider.getChunk).toHaveBeenCalledTimes(2); // 1 initial + 1 throttled reload
    // recentered around the LATEST startTime (lastStart)
    expect(provider.getChunk).toHaveBeenLastCalledWith(
      lastStart - BUFFER_MARGIN,
      lastStart + WINDOW_SIZE + BUFFER_MARGIN
    );
  });

  it('keeps reloading at the throttled rate during sustained rapid navigation, never starving', async () => {
    vi.useFakeTimers();
    const provider = makeProvider(TMAX);
    const { result, rerender } = renderHook(
      ({ startTime, windowSize }) => useEegBuffer(provider, startTime, windowSize),
      { initialProps: { startTime: START, windowSize: WINDOW_SIZE } }
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.isLoading).toBe(false);

    // Simulate holding a Time-Step key: startTime steps down by 60 every 50ms —
    // faster than RELOAD_DEBOUNCE_MS (150ms), which would starve a naive
    // cancel-and-reschedule debounce forever. marginLeft (= 300 - i*60) first
    // drops below RELOAD_THRESHOLD (100) at the 5th step (i=4); the throttled
    // reload, scheduled then, fires ~150ms later — exactly as the loop ends —
    // using whatever startTime is current by then (the 7th/last step).
    const STEP = 60;
    const steps = [0, 1, 2, 3, 4, 5, 6].map((i) => START - i * STEP);
    for (const startTime of steps) {
      rerender({ startTime, windowSize: WINDOW_SIZE });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
    }

    const lastStart = steps[steps.length - 1];
    expect(provider.getChunk).toHaveBeenCalledTimes(2); // 1 initial + 1 throttled reload
    expect(provider.getChunk).toHaveBeenLastCalledWith(
      lastStart - BUFFER_MARGIN,
      lastStart + WINDOW_SIZE + BUFFER_MARGIN
    );
  });
});

describe('useEegBuffer — memory cap', () => {
  it('caps the buffer span so it stays within MAX_BUFFER_BYTES for high channel-count/fs recordings', async () => {
    const fs = 1000;
    const channelNames = Array.from({ length: 200 }, (_, i) => `Ch${i}`);
    const windowSize = WINDOW_SIZE;
    const provider = makeProvider(100000, { fs, channelNames });
    const startTime = 50000;
    const { result } = renderHook(() => useEegBuffer(provider, startTime, windowSize));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const maxTotalSeconds = MAX_BUFFER_BYTES / (BYTES_PER_SAMPLE * fs * channelNames.length);
    const margin = (maxTotalSeconds - windowSize) / 2;
    // sanity: the cap must actually be smaller than the uncapped margin for this test to be meaningful
    expect(margin).toBeLessThan(N_BUFFER_WINDOWS * windowSize);

    expect(provider.getChunk).toHaveBeenLastCalledWith(
      startTime - margin,
      startTime + windowSize + margin
    );
  });

  it('floors the margin at 0 so the visible window is always loaded, even if it alone exceeds the budget', async () => {
    const fs = 1000;
    const channelNames = Array.from({ length: 200 }, (_, i) => `Ch${i}`);
    const maxTotalSeconds = MAX_BUFFER_BYTES / (BYTES_PER_SAMPLE * fs * channelNames.length);
    const windowSize = Math.ceil(maxTotalSeconds) + 100; // exceeds the budget on its own
    const provider = makeProvider(1000000, { fs, channelNames });
    const startTime = 100000;
    const { result } = renderHook(() => useEegBuffer(provider, startTime, windowSize));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(provider.getChunk).toHaveBeenLastCalledWith(startTime, startTime + windowSize);
  });

  it('still triggers reloads via a proportionally-scaled threshold when the margin is capped', async () => {
    vi.useFakeTimers();
    const fs = 1000;
    const channelNames = Array.from({ length: 200 }, (_, i) => `Ch${i}`);
    const windowSize = WINDOW_SIZE;
    const provider = makeProvider(100000, { fs, channelNames });
    const startTime = 50000;
    const { rerender } = renderHook(
      ({ startTime }) => useEegBuffer(provider, startTime, windowSize),
      { initialProps: { startTime } }
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(provider.getChunk).toHaveBeenCalledTimes(1);

    const maxTotalSeconds = MAX_BUFFER_BYTES / (BYTES_PER_SAMPLE * fs * channelNames.length);
    const margin = (maxTotalSeconds - windowSize) / 2; // ~157.77, well below BUFFER_MARGIN (300)
    const threshold = margin * (RELOAD_MARGIN_WINDOWS / N_BUFFER_WINDOWS); // ~52.59

    // marginLeft after moving by `delta` = margin - delta; cross below `threshold`
    const delta = margin - threshold + 1;
    rerender({ startTime: startTime - delta });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS);
    });

    expect(provider.getChunk).toHaveBeenCalledTimes(2);
  });
});

describe('useEegBuffer — loading state', () => {
  it('isLoading is true only until the initial buffer arrives, not during later reloads', async () => {
    vi.useFakeTimers();
    const provider = makeProvider(10000);
    const { result, rerender } = renderHook(
      ({ startTime, windowSize }) => useEegBuffer(provider, startTime, windowSize),
      { initialProps: { startTime: 500, windowSize: 20 } }
    );
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.isLoading).toBe(false);

    // buffer = [200, 520]; marginLeft = 250 - 200 = 50 < RELOAD_THRESHOLD (100) — triggers a reload
    rerender({ startTime: 250, windowSize: 20 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS);
    });

    // no loading flicker for reloads — the previous buffer remains visible until the swap
    expect(result.current.isLoading).toBe(false);
  });
});

describe('useEegBuffer — stale response handling', () => {
  it('keeps the result of the latest request when an earlier request resolves later', async () => {
    let resolveFirst;
    let resolveSecond;
    const provider = {
      tMax: 10000,
      fs: 256,
      channelNames: ['Ch1'],
      getChunk: vi
        .fn()
        .mockImplementationOnce(() => new Promise((res) => (resolveFirst = res)))
        .mockImplementationOnce(() => new Promise((res) => (resolveSecond = res))),
    };

    const { result, rerender } = renderHook(
      ({ startTime, windowSize }) => useEegBuffer(provider, startTime, windowSize),
      { initialProps: { startTime: 500, windowSize: 20 } }
    );

    // Trigger a second request before the first resolves — since no buffer has loaded
    // yet, this fires immediately rather than being debounced.
    rerender({ startTime: 405, windowSize: 20 });
    await act(async () => {});
    expect(provider.getChunk).toHaveBeenCalledTimes(2);

    // Resolve the second (newer) request first, then the stale first request.
    resolveSecond(makeChunk(325, 505));
    await act(async () => {});
    resolveFirst(makeChunk(420, 600));
    await act(async () => {});

    expect(Array.from(result.current.timestamps)).toEqual([325, 505]);
    expect(result.current.isLoading).toBe(false);
  });
});
