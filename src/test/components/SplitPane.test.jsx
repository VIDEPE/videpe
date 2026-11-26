import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SplitPane } from '@/components/SplitPane';

const renderPane = (props = {}) =>
  render(
    <SplitPane
      leftLabel="EEG"
      rightLabel="Imaging"
      left={<div>Left content</div>}
      right={<div>Right content</div>}
      {...props}
    />
  );

// The h2 is inside the header div, which is inside the panel div
const getLeftHeader = () => screen.getByRole('heading', { name: 'EEG' }).parentElement;
const getRightHeader = () => screen.getByRole('heading', { name: 'Imaging' }).parentElement;
const getLeftPanel = () => getLeftHeader().parentElement;
const getRightPanel = () => getRightHeader().parentElement;
const getDivider = () => document.querySelector('.cursor-col-resize');

describe('SplitPane — initial render', () => {
  it('renders both panel labels', () => {
    renderPane();
    expect(screen.getByRole('heading', { name: 'EEG' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Imaging' })).toBeInTheDocument();
  });

  it('renders left and right content', () => {
    renderPane();
    expect(screen.getByText('Left content')).toBeInTheDocument();
    expect(screen.getByText('Right content')).toBeInTheDocument();
  });

  it('starts at 50/50 split', () => {
    renderPane();
    expect(getLeftPanel().style.width).toBe('50%');
    expect(getRightPanel().style.width).toBe('50%');
  });

  it('shows the divider', () => {
    renderPane();
    expect(getDivider()).toBeInTheDocument();
  });

  it('left panel is DOM-first (order 1), right panel is order 3', () => {
    renderPane();
    expect(getLeftPanel().style.order).toBe('1');
    expect(getRightPanel().style.order).toBe('3');
  });

  it('honours a custom defaultSplitPercent', () => {
    renderPane({ defaultSplitPercent: 35 });
    expect(getLeftPanel().style.width).toBe('35%');
    expect(getRightPanel().style.width).toBe('65%');
  });
});

describe('SplitPane — unrelated mouseup', () => {
  // Regression test: the drag-end handler listens on window, so it must ignore a mouseup
  // without a divider drag (e.g. releasing an unrelated drag) instead of resetting the split
  it('does not change the split when a mouseup fires without a prior divider drag', () => {
    renderPane({ defaultSplitPercent: 35 });
    fireEvent.mouseUp(window);
    expect(getLeftPanel().style.width).toBe('35%');
    expect(getRightPanel().style.width).toBe('65%');
  });
});

describe('SplitPane — maximize', () => {
  it('maximizing left sets left to 100% and right to 0%', () => {
    renderPane();
    fireEvent.click(within(getLeftHeader()).getByTitle('Maximize'));
    expect(getLeftPanel().style.width).toBe('100%');
    expect(getRightPanel().style.width).toBe('0%');
  });

  it('maximizing right sets right to 100% and left to 0%', () => {
    renderPane();
    fireEvent.click(within(getRightHeader()).getByTitle('Maximize'));
    expect(getRightPanel().style.width).toBe('100%');
    expect(getLeftPanel().style.width).toBe('0%');
  });

  it('clicking maximize again restores both panels to 50%', () => {
    renderPane();
    const leftHeader = getLeftHeader();
    fireEvent.click(within(leftHeader).getByTitle('Maximize'));
    fireEvent.click(within(leftHeader).getByTitle('Restore'));
    expect(getLeftPanel().style.width).toBe('50%');
    expect(getRightPanel().style.width).toBe('50%');
  });

  it('hides the divider when maximized', () => {
    renderPane();
    fireEvent.click(within(getLeftHeader()).getByTitle('Maximize'));
    expect(getDivider()).not.toBeInTheDocument();
  });

  it('hides the swap button when maximized', () => {
    renderPane();
    fireEvent.click(within(getLeftHeader()).getByTitle('Maximize'));
    expect(screen.queryByTitle('Swap panels')).not.toBeInTheDocument();
  });
});

describe('SplitPane — swap', () => {
  it('swap button reverses the CSS order of both panels', () => {
    renderPane();
    fireEvent.click(within(getLeftHeader()).getByTitle('Swap panels'));
    expect(getLeftPanel().style.order).toBe('3');
    expect(getRightPanel().style.order).toBe('1');
  });

  it('swapping twice restores original order', () => {
    renderPane();
    const swapBtn = within(getLeftHeader()).getByTitle('Swap panels');
    fireEvent.click(swapBtn);
    fireEvent.click(swapBtn);
    expect(getLeftPanel().style.order).toBe('1');
    expect(getRightPanel().style.order).toBe('3');
  });

  it('calls onSwapChange with the new swapped state', () => {
    const onSwapChange = vi.fn();
    renderPane({ onSwapChange });
    fireEvent.click(within(getLeftHeader()).getByTitle('Swap panels'));
    expect(onSwapChange).toHaveBeenCalledWith(true);
  });

  it('calls onSwapChange(false) when swapping back', () => {
    const onSwapChange = vi.fn();
    renderPane({ onSwapChange });
    const swapBtn = within(getLeftHeader()).getByTitle('Swap panels');
    fireEvent.click(swapBtn);
    fireEvent.click(swapBtn);
    expect(onSwapChange).toHaveBeenLastCalledWith(false);
  });
});

describe('SplitPane — reset buttons', () => {
  it('calls onLeftReset when the left X button is clicked', () => {
    const onLeftReset = vi.fn();
    renderPane({ onLeftReset });
    fireEvent.click(within(getLeftHeader()).getByTitle('Reset viewer'));
    expect(onLeftReset).toHaveBeenCalledOnce();
  });

  it('calls onRightReset when the right X button is clicked', () => {
    const onRightReset = vi.fn();
    renderPane({ onRightReset });
    fireEvent.click(within(getRightHeader()).getByTitle('Reset viewer'));
    expect(onRightReset).toHaveBeenCalledOnce();
  });

  it('does not show a reset button on the left when onLeftReset is not provided', () => {
    renderPane({ onRightReset: vi.fn() });
    expect(within(getLeftHeader()).queryByTitle('Reset viewer')).not.toBeInTheDocument();
  });

  it('does not show a reset button on the right when onRightReset is not provided', () => {
    renderPane({ onLeftReset: vi.fn() });
    expect(within(getRightHeader()).queryByTitle('Reset viewer')).not.toBeInTheDocument();
  });
});

describe('SplitPane — mouse drag', () => {
  // The container is 1000×800 at the origin, so a clientX/clientY maps straight to a percentage
  const setupDrag = (props) => {
    renderPane(props);
    vi.spyOn(getLeftPanel().parentElement, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
    });
    // run the drag's animation frame right away
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb();
      return 1;
    });
  };

  afterEach(() => vi.restoreAllMocks());

  it('resizes the panels to follow the pointer', () => {
    setupDrag();
    fireEvent.mouseDown(getDivider());
    fireEvent.mouseMove(window, { clientX: 300 });
    fireEvent.mouseUp(window);
    expect(getLeftPanel().style.width).toBe('30%');
    expect(getRightPanel().style.width).toBe('70%');
  });

  it('keeps each panel at 25% or more', () => {
    setupDrag();
    fireEvent.mouseDown(getDivider());
    fireEvent.mouseMove(window, { clientX: 50 });
    fireEvent.mouseUp(window);
    expect(getLeftPanel().style.width).toBe('25%');
  });

  it('sizes the panels the other way round when they are swapped', () => {
    setupDrag();
    fireEvent.click(within(getLeftHeader()).getByTitle('Swap panels'));
    fireEvent.mouseDown(getDivider());
    fireEvent.mouseMove(window, { clientX: 300 });
    fireEvent.mouseUp(window);
    // the right panel is shown first, so it gets the 30%
    expect(getRightPanel().style.width).toBe('30%');
    expect(getLeftPanel().style.width).toBe('70%');
  });

  it('highlights the divider while it is dragged', () => {
    setupDrag();
    fireEvent.mouseDown(getDivider());
    expect(getDivider()).toHaveClass('bg-primary');
    fireEvent.mouseUp(window);
    expect(getDivider()).not.toHaveClass('bg-primary');
  });

  it('stops following the pointer once the drag ends', () => {
    setupDrag();
    fireEvent.mouseDown(getDivider());
    fireEvent.mouseMove(window, { clientX: 300 });
    fireEvent.mouseUp(window);
    fireEvent.mouseMove(window, { clientX: 600 });
    expect(getLeftPanel().style.width).toBe('30%');
  });

  it('drags along the height when the panels are stacked on a narrow screen', () => {
    const innerWidth = window.innerWidth;
    window.innerWidth = 500;
    try {
      setupDrag();
      fireEvent.mouseDown(document.querySelector('.cursor-row-resize'));
      fireEvent.mouseMove(window, { clientY: 200 });
      fireEvent.mouseUp(window);
      expect(getLeftPanel().style.flexGrow).toBe('25');
      expect(getRightPanel().style.flexGrow).toBe('75');
    } finally {
      window.innerWidth = innerWidth;
    }
  });
});

describe('SplitPane — touch drag', () => {
  it('highlights the divider while it is dragged and stops when the touch ends', () => {
    renderPane();
    fireEvent.touchStart(getDivider(), { touches: [{ clientX: 0, clientY: 0 }] });
    expect(getDivider()).toHaveClass('bg-primary');
    fireEvent.touchEnd(window);
    expect(getDivider()).not.toHaveClass('bg-primary');
  });

  it('stops the drag when the touch is cancelled (e.g. by a system gesture)', () => {
    renderPane();
    fireEvent.touchStart(getDivider(), { touches: [{ clientX: 0, clientY: 0 }] });
    fireEvent.touchCancel(window); // no touchend follows a cancelled touch
    expect(getDivider()).not.toHaveClass('bg-primary');
  });
});
