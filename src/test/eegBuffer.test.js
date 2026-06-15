import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useEegBuffer, N_BUFFER_WINDOWS } from '@/loaders/eegBuffer';

const RELOAD_DEBOUNCE_MS = 150;

const makeChunk = (start, end) => ({
  timestamps: new Float32Array([start, end]),
  channels: [new Float32Array([start, end])],
});

const makeProvider = (tMax) => ({
  tMax,
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
    // bufferStart = clamp(0 - 4*20, 0, 100) = 0, bufferEnd = clamp(0 + 20 + 4*20, 0, 100) = 100
    expect(provider.getChunk).toHaveBeenCalledWith(0, 100);
  });

  it('clamps the buffer to [0, tMax] near the end of the recording', async () => {
    const provider = makeProvider(100);
    const { result } = renderHook(() => useEegBuffer(provider, 80, 20)); // window = [80, 100]
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // bufferStart = clamp(80 - 4*20, 0, 100) = 0, bufferEnd = clamp(80 + 20 + 4*20, 0, 100) = 100
    expect(provider.getChunk).toHaveBeenCalledWith(0, 100);
  });
});

describe('useEegBuffer — reload triggers', () => {
  it('does not refetch for small startTime changes within the buffer margin', async () => {
    const provider = makeProvider(10000);
    const { result, rerender } = renderHook(
      ({ startTime, windowSize }) => useEegBuffer(provider, startTime, windowSize),
      { initialProps: { startTime: 500, windowSize: 20 } }
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // buffer = [420, 600]; new window [510, 530] still has >= windowSize margin on both sides
    rerender({ startTime: 510, windowSize: 20 });
    await act(async () => {});

    expect(provider.getChunk).toHaveBeenCalledTimes(1);
  });

  it('refetches with a recentered buffer once the margin drops below windowSize', async () => {
    vi.useFakeTimers();
    const provider = makeProvider(10000);
    const { result, rerender } = renderHook(
      ({ startTime, windowSize }) => useEegBuffer(provider, startTime, windowSize),
      { initialProps: { startTime: 500, windowSize: 20 } }
    );
    // initial load resolves via microtask, not a timer — flush it
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.isLoading).toBe(false);

    // buffer = [420, 600]; marginLeft = 405 - 420 = -15 < windowSize(20)
    rerender({ startTime: 405, windowSize: 20 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS);
    });

    expect(provider.getChunk).toHaveBeenCalledTimes(2);
    // recentered: bufferStart = clamp(405 - 80, 0, 10000) = 325, bufferEnd = clamp(405+20+80, ...) = 505
    expect(provider.getChunk).toHaveBeenLastCalledWith(325, 505);
  });

  it('debounces rapid successive startTime changes into a single refetch', async () => {
    vi.useFakeTimers();
    const provider = makeProvider(10000);
    const { result, rerender } = renderHook(
      ({ startTime, windowSize }) => useEegBuffer(provider, startTime, windowSize),
      { initialProps: { startTime: 500, windowSize: 20 } }
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.isLoading).toBe(false);

    rerender({ startTime: 400, windowSize: 20 });
    rerender({ startTime: 401, windowSize: 20 });
    rerender({ startTime: 402, windowSize: 20 });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS);
    });

    expect(provider.getChunk).toHaveBeenCalledTimes(2); // 1 initial + 1 debounced reload
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

    // trigger a reload
    rerender({ startTime: 405, windowSize: 20 });
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
