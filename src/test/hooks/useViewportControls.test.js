import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useViewportControls } from '@/hooks/useViewportControls';

// tMax=30 (≥20) → default windowSize=20. channelCount=5, channelAreaHeight=0 (not yet
// measured) → maxChannelsByHeight falls back to channelCount, so channel count is only
// capped by channelCount until a real height is supplied.
const setup = (overrides = {}) =>
  renderHook((props) => useViewportControls(props), {
    initialProps: { tMax: 30, channelCount: 5, channelAreaHeight: 0, ...overrides },
  });

describe('useViewportControls — defaults', () => {
  it('initialises windowSize to 20 for a recording ≥ 20s', () => {
    const { result } = setup();
    expect(result.current.windowSize).toBe(20);
  });

  it('initialises windowSize to the (1-decimal-floored) full recording when shorter than 20s', () => {
    // 6.01171875 floors to 6.0, not the raw float or a ceil'd 7
    const { result } = setup({ tMax: 6.01171875 });
    expect(result.current.windowSize).toBe(6);
  });

  it('clamps the default visibleChannelCount (20) down to channelCount on mount', () => {
    // The re-clamp effect runs on mount too (not just on later channelAreaHeight changes),
    // so a recording with fewer than 20 channels never briefly reports a too-high count.
    const { result } = setup({ channelCount: 3 });
    expect(result.current.visibleChannelCount).toBe(3);
  });

  it('initialises startTime to 0, shiftTimeStepSize to 5, yScale to 0.15', () => {
    const { result } = setup();
    expect(result.current.startTime).toBe(0);
    expect(result.current.shiftTimeStepSize).toBe(5);
    expect(result.current.yScale).toBe(0.15);
  });
});

describe('useViewportControls — updateWindowSize', () => {
  it('clamps to tMax and rounds to 1 decimal', () => {
    const { result } = setup({ tMax: 30.123456 });
    act(() => result.current.updateWindowSize(31));
    expect(result.current.windowSize).toBe(30.1);
  });

  it('clamps to a minimum of 1', () => {
    const { result } = setup();
    act(() => result.current.updateWindowSize(-5));
    expect(result.current.windowSize).toBe(1);
  });

  it('pulls startTime back when the new window would push the end past tMax', () => {
    const { result } = setup();
    act(() => result.current.forwardshiftStartTime()); // startTime 0 → 5
    act(() => result.current.forwardshiftStartTime()); // startTime 5 → 10
    act(() => result.current.updateWindowSize(30)); // end would be 10+30=40 > tMax=30
    expect(result.current.startTime).toBe(0); // pulled back to tMax - windowSize
  });

  it('clamps an oversized shiftTimeStepSize down to the new window size', () => {
    const { result } = setup();
    act(() => result.current.onShiftTimeStepChange({ target: { value: '15' } }));
    expect(result.current.shiftTimeStepSize).toBe(15);
    act(() => result.current.updateWindowSize(10)); // 15 > 10
    expect(result.current.shiftTimeStepSize).toBe(10);
  });
});

describe('useViewportControls — updateShiftTimeStepSize', () => {
  it('clamps to a minimum of 1', () => {
    const { result } = setup();
    act(() => result.current.updateShiftTimeStepSize(0));
    expect(result.current.shiftTimeStepSize).toBe(1);
  });

  it('clamps to the current window size', () => {
    const { result } = setup();
    act(() => result.current.updateShiftTimeStepSize(25)); // windowSize=20
    expect(result.current.shiftTimeStepSize).toBe(20);
  });
});

describe('useViewportControls — updateYScale', () => {
  it('clamps to Y_MIN (0.001) at the low end', () => {
    const { result } = setup();
    act(() => result.current.updateYScale(0));
    expect(result.current.yScale).toBe(0.001);
  });

  it('clamps to Y_MAX (99999) at the high end', () => {
    const { result } = setup();
    act(() => result.current.updateYScale(200000));
    expect(result.current.yScale).toBe(99999);
  });

  it('rounds to 3 decimal places', () => {
    const { result } = setup();
    act(() => result.current.updateYScale(0.0015)); // → 0.002 (Math.round)
    expect(result.current.yScale).toBe(0.002);
  });
});

describe('useViewportControls — updateVisibleChannelCount', () => {
  it('clamps to a minimum of 1', () => {
    const { result } = setup();
    act(() => result.current.updateVisibleChannelCount(0));
    expect(result.current.visibleChannelCount).toBe(1);
  });

  it('clamps to channelCount', () => {
    const { result } = setup({ channelCount: 3 });
    act(() => result.current.updateVisibleChannelCount(10));
    expect(result.current.visibleChannelCount).toBe(3);
  });

  it('clamps to how many lanes fit in channelAreaHeight (MIN_PLOT_HEIGHT=12px)', () => {
    const { result } = setup({ channelCount: 50, channelAreaHeight: 60 }); // 60/12 = 5 lanes max
    act(() => result.current.updateVisibleChannelCount(50));
    expect(result.current.visibleChannelCount).toBe(5);
  });

  it('re-clamps automatically when channelAreaHeight shrinks after a resize', () => {
    const { result, rerender } = setup({ channelCount: 50, channelAreaHeight: 300 }); // 25 lanes max
    act(() => result.current.updateVisibleChannelCount(20));
    expect(result.current.visibleChannelCount).toBe(20);

    rerender({ tMax: 30, channelCount: 50, channelAreaHeight: 60 }); // now only 5 lanes fit
    expect(result.current.visibleChannelCount).toBe(5);
  });
});

describe('useViewportControls — input change/blur handlers', () => {
  it('onWindowSizeChange ignores input longer than the max length', () => {
    const { result } = setup({ tMax: 30 }); // WINDOW_INPUT_MAX_LENGTH = len("30")+2 = 4
    act(() => result.current.onWindowSizeChange({ target: { value: '123456' } }));
    expect(result.current.windowSizeStr).toBe('20'); // unchanged
  });

  it('onWindowSizeChange updates the Str state live without clamping mid-typing', () => {
    const { result } = setup();
    act(() => result.current.onWindowSizeChange({ target: { value: '5' } }));
    expect(result.current.windowSizeStr).toBe('5');
    expect(result.current.windowSize).toBe(5);
  });

  it('onWindowSizeBlur snaps the Str value through updateWindowSize', () => {
    const { result } = setup();
    act(() => result.current.onWindowSizeChange({ target: { value: '5.75' } }));
    act(() => result.current.onWindowSizeBlur());
    expect(result.current.windowSize).toBe(5.8); // rounded to 1 decimal
    expect(result.current.windowSizeStr).toBe('5.8');
  });

  it('onWindowSizeBlur falls back to the last valid windowSize when the field is empty', () => {
    const { result } = setup();
    act(() => result.current.onWindowSizeChange({ target: { value: '' } }));
    act(() => result.current.onWindowSizeBlur());
    expect(result.current.windowSize).toBe(20); // unchanged default
  });

  it('onYScaleChange ignores input longer than 5 characters', () => {
    const { result } = setup();
    act(() => result.current.onYScaleChange({ target: { value: '123456' } }));
    expect(result.current.yScaleStr).toBe('0.15'); // unchanged
  });

  it('onShiftTimeStepChange clamps live typing to the current window size', () => {
    const { result } = setup();
    act(() => result.current.onShiftTimeStepChange({ target: { value: '25' } })); // > windowSize=20
    expect(result.current.shiftTimeStepSize).toBe(20);
  });

  it('onVisibleChannelCountBlur rounds a fractional typed value to the nearest integer', () => {
    // channelCount needs enough digits for CHANNEL_INPUT_MAX_LENGTH to accept "2.5" (3 chars)
    const { result } = setup({ channelCount: 100 });
    act(() => result.current.onVisibleChannelCountChange({ target: { value: '2.5' } }));
    act(() => result.current.onVisibleChannelCountBlur());
    expect(result.current.visibleChannelCount).toBe(3);
  });
});

describe('useViewportControls — step helpers', () => {
  it('increaseWindowSize steps by 10, clamped to tMax', () => {
    const { result } = setup();
    act(() => result.current.increaseWindowSize()); // 20 → 30 (= tMax)
    expect(result.current.windowSize).toBe(30);
    act(() => result.current.increaseWindowSize()); // stays at 30
    expect(result.current.windowSize).toBe(30);
  });

  it('decreaseWindowSize steps by 10, clamped to a minimum of 1', () => {
    const { result } = setup();
    act(() => result.current.decreaseWindowSize()); // 20 → 10
    expect(result.current.windowSize).toBe(10);
    act(() => result.current.decreaseWindowSize()); // 10 → 1 (not 0)
    expect(result.current.windowSize).toBe(1);
  });

  it('forwardshiftStartTime pans by shiftTimeStepSize, clamped at tMax - windowSize', () => {
    const { result } = setup(); // tMax=30, windowSize=20 → ceiling is 10
    act(() => result.current.forwardshiftStartTime()); // 0 → 5
    act(() => result.current.forwardshiftStartTime()); // 5 → 10
    act(() => result.current.forwardshiftStartTime()); // clamped at 10
    expect(result.current.startTime).toBe(10);
  });

  it('backwardshiftStartTime pans backward, clamped at 0', () => {
    const { result } = setup();
    act(() => result.current.forwardshiftStartTime()); // 0 → 5
    act(() => result.current.backwardshiftStartTime()); // 5 → 0
    act(() => result.current.backwardshiftStartTime()); // clamped at 0
    expect(result.current.startTime).toBe(0);
  });
});
