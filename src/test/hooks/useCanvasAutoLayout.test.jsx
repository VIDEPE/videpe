import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useCanvasAutoLayout } from '@/hooks/useCanvasAutoLayout';

// Moved here from NiiViewer.test.jsx's "canvas aspect ratio layout" block — this is pure
// aspect-ratio/debounce logic with no NiiVue rendering involved, so it's cheaper and clearer to
// exercise directly than through a full component mount. NiiViewer.test.jsx keeps one smoke
// test confirming the hook is actually wired up.

vi.mock('@niivue/niivue', () => ({ MULTIPLANAR_TYPE: { GRID: 2, AUTO: 3 } }));

function TestComponent({ nvRef }) {
  const { canvasContainerRef } = useCanvasAutoLayout({ nvRef });
  return <div ref={canvasContainerRef} />;
}

describe('useCanvasAutoLayout', () => {
  let resizeCallbacks;
  const fireResize = (entries) => resizeCallbacks.forEach((cb) => cb(entries));

  beforeEach(() => {
    resizeCallbacks = [];
    global.ResizeObserver = class {
      constructor(cb) {
        resizeCallbacks.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    // shouldAdvanceTime keeps real-time-driven helpers like waitFor working alongside fake timers
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (nv = { setMultiplanarLayout: vi.fn() }) => {
    const nvRef = { current: nv };
    render(<TestComponent nvRef={nvRef} />);
    // Mount itself fires the layout effect once with the initial {0, 0} size (GRID, since
    // height isn't > 0 yet) — clear that so assertions only count post-resize calls.
    nv.setMultiplanarLayout.mockClear();
    return nv;
  };

  it('switches to AUTO layout when width is at least 1.75x the height', async () => {
    const { MULTIPLANAR_TYPE } = await import('@niivue/niivue');
    const nv = setup();
    act(() => {
      fireResize([{ contentRect: { width: 800, height: 200 } }]); // 4x
      vi.advanceTimersByTime(150); // flush the resize-size debounce
    });
    expect(nv.setMultiplanarLayout).toHaveBeenCalledWith(MULTIPLANAR_TYPE.AUTO);
  });

  it('uses GRID layout when width is less than 1.75x the height', async () => {
    const { MULTIPLANAR_TYPE } = await import('@niivue/niivue');
    const nv = setup();
    act(() => {
      fireResize([{ contentRect: { width: 400, height: 300 } }]);
      vi.advanceTimersByTime(150);
    });
    expect(nv.setMultiplanarLayout).toHaveBeenCalledWith(MULTIPLANAR_TYPE.GRID);
  });

  it('treats exactly 1.75x as wide (boundary is inclusive)', async () => {
    const { MULTIPLANAR_TYPE } = await import('@niivue/niivue');
    const nv = setup();
    act(() => {
      fireResize([{ contentRect: { width: 350, height: 200 } }]); // 1.75x exactly
      vi.advanceTimersByTime(150);
    });
    expect(nv.setMultiplanarLayout).toHaveBeenCalledWith(MULTIPLANAR_TYPE.AUTO);
  });

  it('debounces rapid resizes, applying only the last measurement', async () => {
    const { MULTIPLANAR_TYPE } = await import('@niivue/niivue');
    const nv = setup();
    act(() => {
      fireResize([{ contentRect: { width: 400, height: 300 } }]); // would be GRID
      vi.advanceTimersByTime(50); // before the debounce settles
      fireResize([{ contentRect: { width: 800, height: 200 } }]); // would be AUTO
      vi.advanceTimersByTime(150);
    });
    expect(nv.setMultiplanarLayout).toHaveBeenCalledTimes(1);
    expect(nv.setMultiplanarLayout).toHaveBeenCalledWith(MULTIPLANAR_TYPE.AUTO);
  });

  it('does not throw when nv has not attached yet', () => {
    const nvRef = { current: null };
    render(<TestComponent nvRef={nvRef} />);
    expect(() => {
      act(() => {
        fireResize([{ contentRect: { width: 800, height: 200 } }]);
        vi.advanceTimersByTime(150);
      });
    }).not.toThrow();
  });

  it('disconnects the ResizeObserver on unmount', () => {
    const disconnectSpy = vi.fn();
    global.ResizeObserver = class {
      constructor(cb) {
        resizeCallbacks.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect = disconnectSpy;
    };
    const nvRef = { current: { setMultiplanarLayout: vi.fn() } };
    const { unmount } = render(<TestComponent nvRef={nvRef} />);
    unmount();
    expect(disconnectSpy).toHaveBeenCalled();
  });
});
