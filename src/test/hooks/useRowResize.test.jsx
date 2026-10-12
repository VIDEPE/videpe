import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useRowResize } from '@/hooks/useRowResize';

// this is pure drag-to-resize math with no NiiVue/uPlot involved.
// NiiViewer.test.jsx and EegViewer.test.jsx keeps one smoke test confirming the hook is actually wired up to the real resize handle.

function TestComponent({ minHeight }) {
  const { rowRef, handleResizeStart, isDragging } = useRowResize(minHeight);
  return (
    <div
      data-testid="row"
      data-dragging={isDragging}
      ref={rowRef}
      onMouseDown={handleResizeStart}
      onTouchStart={handleResizeStart}
    />
  );
}

describe('useRowResize', () => {
  const setup = (minHeight = 350) => {
    render(<TestComponent minHeight={minHeight} />);
    const row = screen.getByTestId('row');
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ height: 400 });
    return row;
  };

  it('raises the row min-height when the handle is dragged down', () => {
    const row = setup();
    fireEvent.mouseDown(row, { clientY: 0 });
    fireEvent.mouseMove(window, { clientY: 150 });
    fireEvent.mouseUp(window);

    expect(row.style.minHeight).toBe('550px'); // 400 (starting height) + 150 (drag delta)
  });

  it('lowers the row min-height when the handle is dragged up', () => {
    const row = setup();
    fireEvent.mouseDown(row, { clientY: 0 });
    fireEvent.mouseMove(window, { clientY: -50 });
    fireEvent.mouseUp(window);

    expect(row.style.minHeight).toBe('350px'); // 400 (starting height) - 50 (drag delta)
  });

  it('clamps at the minHeight floor instead of shrinking further', () => {
    const row = setup(350);
    fireEvent.mouseDown(row, { clientY: 0 });
    fireEvent.mouseMove(window, { clientY: -2000 }); // drag far past any reasonable minimum
    fireEvent.mouseUp(window);

    expect(row.style.minHeight).toBe('350px');
  });

  it('respects a caller-supplied minHeight floor, not just the default', () => {
    const row = setup(500);
    fireEvent.mouseDown(row, { clientY: 0 });
    fireEvent.mouseMove(window, { clientY: -2000 });
    fireEvent.mouseUp(window);

    expect(row.style.minHeight).toBe('500px');
  });

  it('stops responding to mouse movement once the drag ends', () => {
    const row = setup();
    fireEvent.mouseDown(row, { clientY: 0 });
    fireEvent.mouseMove(window, { clientY: 100 });
    fireEvent.mouseUp(window);
    fireEvent.mouseMove(window, { clientY: 500 }); // should be ignored — drag already ended

    expect(row.style.minHeight).toBe('500px');
  });

  // isDragging lets the handle stay highlighted for the whole drag, even when the pointer or
  // finger moves off it (CSS :active doesn't cover that)
  it('reports isDragging for the whole mouse drag', () => {
    const row = setup();
    expect(row.dataset.dragging).toBe('false');
    fireEvent.mouseDown(row, { clientY: 0 });
    fireEvent.mouseMove(window, { clientY: 100 });
    expect(row.dataset.dragging).toBe('true');
    fireEvent.mouseUp(window);
    expect(row.dataset.dragging).toBe('false');
  });

  // Touch screens send touch events instead of mouse events while dragging a finger
  describe('touch', () => {
    it('reports isDragging until the touch ends', () => {
      const row = setup();
      fireEvent.touchStart(row, { touches: [{ clientY: 0 }] });
      fireEvent.touchMove(window, { touches: [{ clientY: 100 }] });
      expect(row.dataset.dragging).toBe('true');
      fireEvent.touchEnd(window);
      expect(row.dataset.dragging).toBe('false');
    });

    it('resizes the row when the handle is dragged with a finger', () => {
      const row = setup();
      fireEvent.touchStart(row, { touches: [{ clientY: 0 }] });
      fireEvent.touchMove(window, { touches: [{ clientY: 150 }] });
      fireEvent.touchEnd(window);

      expect(row.style.minHeight).toBe('550px'); // 400 (starting height) + 150 (drag delta)
    });

    it('stops responding to finger movement once the touch ends', () => {
      const row = setup();
      fireEvent.touchStart(row, { touches: [{ clientY: 0 }] });
      fireEvent.touchMove(window, { touches: [{ clientY: 100 }] });
      fireEvent.touchEnd(window);
      fireEvent.touchMove(window, { touches: [{ clientY: 500 }] }); // drag already ended

      expect(row.style.minHeight).toBe('500px');
    });

    it('stops the drag when the touch is cancelled (e.g. by a system gesture)', () => {
      const row = setup();
      fireEvent.touchStart(row, { touches: [{ clientY: 0 }] });
      fireEvent.touchCancel(window);
      fireEvent.touchMove(window, { touches: [{ clientY: 500 }] });

      expect(row.style.minHeight).toBe(''); // never resized
    });
  });
});
