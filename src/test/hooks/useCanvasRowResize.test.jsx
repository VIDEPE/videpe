import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useCanvasRowResize } from '@/hooks/useCanvasRowResize';

// Moved here from NiiViewer.test.jsx's "canvas resize handle" block — this is pure drag-to-
// resize math with no NiiVue involved. NiiViewer.test.jsx keeps one smoke test confirming the
// hook is actually wired up to the real resize handle.

function TestComponent({ minHeight }) {
  const { canvasRowRef, handleCanvasResizeStart } = useCanvasRowResize(minHeight);
  return <div data-testid="row" ref={canvasRowRef} onMouseDown={handleCanvasResizeStart} />;
}

describe('useCanvasRowResize', () => {
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
});
