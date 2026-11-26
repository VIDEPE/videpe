import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useFloatingWindow } from '@/hooks/useFloatingWindow';
import { WindowResizeHandles } from '@/components/WindowResizeHandles';

// The drag/resize/maximize plumbing shared by the Montage Editor, filters window and topo
// viewer; their own tests only check it's wired up

const DEFAULTS = {
  defaultPosition: { x: 40, y: 50 },
  defaultSize: { width: 400, height: 300 },
  minSize: { width: 200, height: 150 },
};

function TestWindow(props) {
  const { isMaximized, toggleMaximize, windowProps, handleDragStart, handleResizeStart } =
    useFloatingWindow(props);
  return (
    <div data-testid="window" {...windowProps}>
      <div data-testid="title-bar" onMouseDown={handleDragStart} onTouchStart={handleDragStart}>
        <button type="button" onClick={toggleMaximize}>
          Maximize
        </button>
      </div>
      {!isMaximized && <WindowResizeHandles testIdPrefix="win" onResizeStart={handleResizeStart} />}
    </div>
  );
}

const setup = (props = DEFAULTS) => {
  render(<TestWindow {...props} />);
  return screen.getByTestId('window');
};

// a mouse drag from (0, 0) by (dx, dy) on the given element
const drag = (el, dx, dy) => {
  fireEvent.mouseDown(el, { clientX: 0, clientY: 0 });
  fireEvent.mouseMove(window, { clientX: dx, clientY: dy });
  fireEvent.mouseUp(window);
};

const box = (win) => ({
  left: parseInt(win.style.left),
  top: parseInt(win.style.top),
  width: parseInt(win.style.width),
  height: parseInt(win.style.height),
});

describe('useFloatingWindow', () => {
  it('opens at its default position and size', () => {
    expect(box(setup())).toEqual({ left: 40, top: 50, width: 400, height: 300 });
  });

  describe('drag by the title bar', () => {
    it('moves the window', () => {
      const win = setup();
      drag(screen.getByTestId('title-bar'), 30, 20);
      expect(box(win)).toMatchObject({ left: 70, top: 70 });
    });

    it('stops at the top-left edge of the screen', () => {
      const win = setup();
      drag(screen.getByTestId('title-bar'), -5000, -5000);
      expect(box(win)).toMatchObject({ left: 0, top: 0 });
    });

    it('stops at the bottom-right edge of the screen', () => {
      const win = setup();
      drag(screen.getByTestId('title-bar'), 50000, 50000);
      expect(box(win)).toMatchObject({
        left: window.innerWidth - 400,
        top: window.innerHeight - 300,
      });
    });
  });

  describe('resize by the edges and corners', () => {
    it('grows width and height from the bottom-right corner', () => {
      const win = setup();
      drag(screen.getByTestId('win-resize-se'), 50, 30);
      expect(box(win)).toEqual({ left: 40, top: 50, width: 450, height: 330 });
    });

    it('grows only the width from the right edge', () => {
      const win = setup();
      drag(screen.getByTestId('win-resize-e'), 40, 25);
      expect(box(win)).toEqual({ left: 40, top: 50, width: 440, height: 300 });
    });

    it('grows the width and moves the window left from the left edge', () => {
      const win = setup();
      drag(screen.getByTestId('win-resize-w'), -30, 0);
      expect(box(win)).toMatchObject({ left: 10, width: 430 });
    });

    it('grows the height and moves the window up from the top edge', () => {
      const win = setup();
      drag(screen.getByTestId('win-resize-n'), 0, -20);
      expect(box(win)).toMatchObject({ top: 30, height: 320 });
    });

    it('stops shrinking at the minimum size', () => {
      const win = setup();
      drag(screen.getByTestId('win-resize-se'), -2000, -2000);
      expect(box(win)).toMatchObject({ width: 200, height: 150 });
    });

    it('keeps the opposite edge in place when shrinking from the top-left corner hits the minimum', () => {
      const win = setup();
      drag(screen.getByTestId('win-resize-nw'), 2000, 2000);
      // right edge 440 and bottom edge 350 stay where they were
      expect(box(win)).toEqual({ left: 240, top: 200, width: 200, height: 150 });
    });
  });

  // Touch screens send touch events, with the finger position in touches[0]
  describe('touch', () => {
    const touchDrag = (el, dx, dy) => {
      fireEvent.touchStart(el, { touches: [{ clientX: 0, clientY: 0 }] });
      fireEvent.touchMove(window, { touches: [{ clientX: dx, clientY: dy }] });
      fireEvent.touchEnd(window);
    };

    it('moves the window when the title bar is dragged with a finger', () => {
      const win = setup();
      touchDrag(screen.getByTestId('title-bar'), 30, 20);
      expect(box(win)).toMatchObject({ left: 70, top: 70 });
    });

    it('resizes the window when an edge is dragged with a finger', () => {
      const win = setup();
      touchDrag(screen.getByTestId('win-resize-se'), 50, 30);
      expect(box(win)).toEqual({ left: 40, top: 50, width: 450, height: 330 });
    });

    it('stops following the finger once it is lifted', () => {
      const win = setup();
      touchDrag(screen.getByTestId('title-bar'), 30, 20);
      fireEvent.touchMove(window, { touches: [{ clientX: 300, clientY: 300 }] });
      expect(box(win)).toMatchObject({ left: 70, top: 70 });
    });
  });

  describe('on a screen smaller than the default window', () => {
    const screenSize = { width: window.innerWidth, height: window.innerHeight };
    const setScreen = (width, height) => {
      window.innerWidth = width;
      window.innerHeight = height;
    };
    afterEach(() => setScreen(screenSize.width, screenSize.height));

    it('shrinks the window to the screen and moves it fully on screen', () => {
      setScreen(390, 844); // phone, portrait
      // default 400 wide at x 40, minimum 200 wide: fits once shrunk to the screen width
      expect(box(setup())).toEqual({ left: 0, top: 50, width: 390, height: 300 });
    });

    it('moves a window that fits but would stick out back on screen', () => {
      setScreen(700, 500);
      const props = { ...DEFAULTS, defaultPosition: { x: 400, y: 300 } };
      expect(box(setup(props))).toEqual({ left: 300, top: 200, width: 400, height: 300 });
    });

    it('opens maximized when the screen is narrower than the minimum size', () => {
      setScreen(390, 844);
      const win = setup({ ...DEFAULTS, minSize: { width: 600, height: 150 } });
      expect(win.className).toContain('inset-0');
      expect(screen.queryByTestId('win-resize-e')).not.toBeInTheDocument();
    });

    it('opens maximized when the screen is lower than the minimum size', () => {
      setScreen(844, 390); // phone, landscape
      const win = setup({ ...DEFAULTS, minSize: { width: 200, height: 450 } });
      expect(win.className).toContain('inset-0');
    });

    it('restores a window opened maximized to one that fits the screen', () => {
      setScreen(390, 844);
      const win = setup({ ...DEFAULTS, minSize: { width: 600, height: 150 } });
      fireEvent.click(screen.getByRole('button', { name: 'Maximize' }));
      expect(box(win)).toEqual({ left: 0, top: 50, width: 390, height: 300 });
    });

    it('keeps the default position and size when the window fits', () => {
      setScreen(1920, 1080);
      expect(box(setup())).toEqual({ left: 40, top: 50, width: 400, height: 300 });
    });
  });

  describe('maximize', () => {
    it('fills the screen without a position or size of its own', () => {
      const win = setup();
      fireEvent.click(screen.getByRole('button', { name: 'Maximize' }));
      expect(win.className).toContain('inset-0');
      expect(win.style.left).toBe('');
      expect(win.style.width).toBe('');
    });

    it('goes back to its last position and size when restored', () => {
      const win = setup();
      drag(screen.getByTestId('title-bar'), 30, 20);
      fireEvent.click(screen.getByRole('button', { name: 'Maximize' }));
      fireEvent.click(screen.getByRole('button', { name: 'Maximize' }));
      expect(box(win)).toEqual({ left: 70, top: 70, width: 400, height: 300 });
    });
  });
});

describe('WindowResizeHandles', () => {
  const DIRECTIONS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

  it('renders a handle on every edge and corner, drawn above the window content', () => {
    render(<WindowResizeHandles testIdPrefix="win" onResizeStart={vi.fn()} />);
    DIRECTIONS.forEach((direction) =>
      expect(screen.getByTestId(`win-resize-${direction}`).className).toContain('z-20')
    );
  });

  it('passes the edge or corner that was grabbed', () => {
    const onResizeStart = vi.fn();
    render(<WindowResizeHandles testIdPrefix="win" onResizeStart={onResizeStart} />);
    fireEvent.mouseDown(screen.getByTestId('win-resize-sw'));
    expect(onResizeStart).toHaveBeenCalledWith(expect.anything(), 'sw');
  });

  // the top edge and corners stay narrow, so they don't cover the title bar's buttons
  it('makes the sides, bottom and bottom corners wider on touchscreens', () => {
    render(<WindowResizeHandles testIdPrefix="win" onResizeStart={vi.fn()} />);
    const classOf = (direction) => screen.getByTestId(`win-resize-${direction}`).className;
    ['e', 'w'].forEach((direction) => expect(classOf(direction)).toContain('pointer-coarse:w-3'));
    expect(classOf('s')).toContain('pointer-coarse:h-3');
    ['se', 'sw'].forEach((direction) =>
      expect(classOf(direction)).toContain('pointer-coarse:w-5 pointer-coarse:h-5')
    );
    ['n', 'ne', 'nw'].forEach((direction) =>
      expect(classOf(direction)).not.toContain('pointer-coarse')
    );
  });

  it('also starts a resize on touch, without the page scrolling along', () => {
    const onResizeStart = vi.fn();
    render(<WindowResizeHandles testIdPrefix="win" onResizeStart={onResizeStart} />);
    const handle = screen.getByTestId('win-resize-ne');
    fireEvent.touchStart(handle, { touches: [{ clientX: 0, clientY: 0 }] });
    expect(onResizeStart).toHaveBeenCalledWith(expect.anything(), 'ne');
    expect(handle.className).toContain('touch-none');
  });
});
