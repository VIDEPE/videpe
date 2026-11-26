import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { usePointerDrag } from '@/hooks/usePointerDrag';

// The mouse/touch plumbing shared by useRowResize and SplitPane; the drag maths is tested there

function TestComponent({ onDragStart }) {
  const { handleDragStart, isDragging } = usePointerDrag(onDragStart);
  return (
    <div
      data-testid="handle"
      data-dragging={isDragging}
      onMouseDown={handleDragStart}
      onTouchStart={handleDragStart}
    />
  );
}

const setup = (onDragStart) => {
  render(<TestComponent onDragStart={onDragStart} />);
  return screen.getByTestId('handle');
};

// onDragStart returning spies for the drag it starts
const makeDrag = () => {
  const drag = { onMove: vi.fn(), onEnd: vi.fn() };
  return { drag, onDragStart: vi.fn(() => drag) };
};

describe('usePointerDrag', () => {
  describe('mouse', () => {
    it('passes the start point, every move point, and the end to the drag', () => {
      const { drag, onDragStart } = makeDrag();
      const handle = setup(onDragStart);
      fireEvent.mouseDown(handle, { clientX: 1, clientY: 2 });
      fireEvent.mouseMove(window, { clientX: 3, clientY: 4 });
      fireEvent.mouseUp(window);

      expect(onDragStart).toHaveBeenCalledWith({ clientX: 1, clientY: 2 });
      expect(drag.onMove).toHaveBeenCalledWith({ clientX: 3, clientY: 4 });
      expect(drag.onEnd).toHaveBeenCalledOnce();
    });

    it('stops listening once the drag ends', () => {
      const { drag, onDragStart } = makeDrag();
      const handle = setup(onDragStart);
      fireEvent.mouseDown(handle);
      fireEvent.mouseUp(window);
      fireEvent.mouseMove(window, { clientX: 5, clientY: 5 });
      fireEvent.mouseUp(window);

      expect(drag.onMove).not.toHaveBeenCalled();
      expect(drag.onEnd).toHaveBeenCalledOnce();
    });

    it('ignores moves and releases without a drag started on the handle', () => {
      const { drag, onDragStart } = makeDrag();
      setup(onDragStart);
      fireEvent.mouseMove(window, { clientX: 5, clientY: 5 });
      fireEvent.mouseUp(window);

      expect(drag.onMove).not.toHaveBeenCalled();
      expect(drag.onEnd).not.toHaveBeenCalled();
    });

    it('prevents text selection when the drag starts', () => {
      const handle = setup(makeDrag().onDragStart);
      // fireEvent returns false when the event's default was prevented
      expect(fireEvent.mouseDown(handle)).toBe(false);
    });

    it('reports isDragging for the whole drag', () => {
      const handle = setup(makeDrag().onDragStart);
      expect(handle.dataset.dragging).toBe('false');
      fireEvent.mouseDown(handle);
      expect(handle.dataset.dragging).toBe('true');
      fireEvent.mouseUp(window);
      expect(handle.dataset.dragging).toBe('false');
    });

    it("doesn't start a drag when onDragStart returns null", () => {
      const handle = setup(() => null);
      expect(fireEvent.mouseDown(handle)).toBe(true);
      expect(handle.dataset.dragging).toBe('false');
    });

    it('works without an onEnd', () => {
      const onMove = vi.fn();
      const handle = setup(() => ({ onMove }));
      fireEvent.mouseDown(handle);
      fireEvent.mouseUp(window);
      expect(handle.dataset.dragging).toBe('false');
    });
  });

  // Touch screens send touch events, with the finger position in touches[0]
  describe('touch', () => {
    it('passes the finger positions and the end to the drag', () => {
      const { drag, onDragStart } = makeDrag();
      const handle = setup(onDragStart);
      fireEvent.touchStart(handle, { touches: [{ clientX: 1, clientY: 2 }] });
      fireEvent.touchMove(window, { touches: [{ clientX: 3, clientY: 4 }] });
      fireEvent.touchEnd(window);

      expect(onDragStart).toHaveBeenCalledWith({ clientX: 1, clientY: 2 });
      expect(drag.onMove).toHaveBeenCalledWith({ clientX: 3, clientY: 4 });
      expect(drag.onEnd).toHaveBeenCalledOnce();
    });

    it('stops the page from scrolling while dragging', () => {
      const handle = setup(makeDrag().onDragStart);
      fireEvent.touchStart(handle, { touches: [{ clientX: 0, clientY: 0 }] });
      expect(fireEvent.touchMove(window, { touches: [{ clientX: 0, clientY: 9 }] })).toBe(false);
    });

    it('ends the drag when the touch is cancelled (e.g. by a system gesture)', () => {
      const { drag, onDragStart } = makeDrag();
      const handle = setup(onDragStart);
      fireEvent.touchStart(handle, { touches: [{ clientX: 0, clientY: 0 }] });
      fireEvent.touchCancel(window);
      fireEvent.touchMove(window, { touches: [{ clientX: 0, clientY: 9 }] });

      expect(drag.onEnd).toHaveBeenCalledOnce();
      expect(drag.onMove).not.toHaveBeenCalled();
      expect(handle.dataset.dragging).toBe('false');
    });
  });

  it('stops listening when the component unmounts mid-drag', () => {
    const { drag, onDragStart } = makeDrag();
    const { unmount } = render(<TestComponent onDragStart={onDragStart} />);
    fireEvent.mouseDown(screen.getByTestId('handle'));
    unmount();
    fireEvent.mouseMove(window, { clientX: 5, clientY: 5 });

    expect(drag.onMove).not.toHaveBeenCalled();
  });
});
