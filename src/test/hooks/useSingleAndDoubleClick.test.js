import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSingleAndDoubleClick, useDoubleClickToDefault } from '@/hooks/useSingleAndDoubleClick';

describe('useSingleAndDoubleClick', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (delay = 250) => {
    const actionSingleClick = vi.fn();
    const actionDoubleClick = vi.fn();
    const { result } = renderHook(() =>
      useSingleAndDoubleClick(actionSingleClick, actionDoubleClick, delay)
    );
    const click = () => act(() => result.current());
    const advance = (ms) => act(() => vi.advanceTimersByTime(ms));
    return { actionSingleClick, actionDoubleClick, click, advance };
  };

  it('calls actionSingleClick once the delay elapses after a single click', () => {
    const { actionSingleClick, actionDoubleClick, click, advance } = setup();

    click();
    expect(actionSingleClick).not.toHaveBeenCalled();

    advance(250);
    expect(actionSingleClick).toHaveBeenCalledTimes(1);
    expect(actionDoubleClick).not.toHaveBeenCalled();
  });

  it('calls actionDoubleClick (never actionSingleClick) when clicked twice within the delay', () => {
    const { actionSingleClick, actionDoubleClick, click, advance } = setup();

    click();
    advance(100); // well within the 250ms window
    click();

    expect(actionDoubleClick).toHaveBeenCalledTimes(1);

    advance(250); // let the pending reset timer run out
    expect(actionSingleClick).not.toHaveBeenCalled();
  });

  it('treats two clicks separated by more than the delay as two independent single clicks', () => {
    const { actionSingleClick, actionDoubleClick, click, advance } = setup();

    click();
    advance(250);
    expect(actionSingleClick).toHaveBeenCalledTimes(1);

    click();
    advance(250);

    expect(actionSingleClick).toHaveBeenCalledTimes(2);
    expect(actionDoubleClick).not.toHaveBeenCalled();
  });
});

describe('useDoubleClickToDefault', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (defaultVal = 42, delay = 250) => {
    const actionDoubleClick = vi.fn();
    const { result } = renderHook(() =>
      useDoubleClickToDefault(actionDoubleClick, defaultVal, delay)
    );
    const click = () => act(() => result.current());
    const advance = (ms) => act(() => vi.advanceTimersByTime(ms));
    return { actionDoubleClick, click, advance };
  };

  it('treats a plain single click as a no-op', () => {
    const { actionDoubleClick, click, advance } = setup();

    click();
    advance(250);

    expect(actionDoubleClick).not.toHaveBeenCalled();
  });

  it('calls actionDoubleClick with defaultVal when clicked twice within the delay', () => {
    const { actionDoubleClick, click, advance } = setup(42);

    click();
    advance(100); // well within the 250ms window
    click();

    expect(actionDoubleClick).toHaveBeenCalledTimes(1);
    expect(actionDoubleClick).toHaveBeenCalledWith(42);
  });

  it('fires immediately on the second click, without waiting for the delay to elapse', () => {
    const { actionDoubleClick, click, advance } = setup(42);

    click();
    advance(100);
    click();

    // No further time has passed since the second click — the reset timer (250ms) hasn't
    // fired yet, so this confirms actionDoubleClick ran synchronously off the click itself.
    expect(actionDoubleClick).toHaveBeenCalledTimes(1);
  });

  it('ignores a third rapid click before the click counter has reset (only fires once per double click)', () => {
    const { actionDoubleClick, click, advance } = setup(42);

    click();
    advance(50);
    click();
    expect(actionDoubleClick).toHaveBeenCalledTimes(1);

    advance(50); // still within the original window, counter hasn't reset to 0 yet
    click();
    expect(actionDoubleClick).toHaveBeenCalledTimes(1); // third click -> count 3, not 2
  });

  it('fires again on a later double click once the counter has reset', () => {
    const { actionDoubleClick, click, advance } = setup(42);

    click();
    advance(100);
    click();
    expect(actionDoubleClick).toHaveBeenCalledTimes(1);

    advance(250); // let the click counter reset to 0

    click();
    advance(100);
    click();
    expect(actionDoubleClick).toHaveBeenCalledTimes(2);
  });

  it('uses whatever defaultVal is current at call time, including falsy values like 0', () => {
    const { actionDoubleClick, click, advance } = setup(0);

    click();
    advance(100);
    click();

    expect(actionDoubleClick).toHaveBeenCalledWith(0);
  });
});
