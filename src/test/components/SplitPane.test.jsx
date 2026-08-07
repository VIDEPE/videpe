import { describe, it, expect, vi } from 'vitest';
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
  // Regression test: the divider-drag-end handler is registered on window (so it can catch
  // a mouseup anywhere), not scoped to the divider itself. It must ignore a mouseup that
  // wasn't preceded by a mousedown on the divider — e.g. releasing a drag on some unrelated
  // element elsewhere on the page — instead of resetting the split to a stale default.
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
