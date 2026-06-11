import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EegViewer } from '@/components/EegViewer';

vi.mock('uplot-react', () => {
  const UplotReactMock = vi.fn(function () {
    return null;
  });
  return { default: UplotReactMock };
});

vi.mock('@/components/ThemeContext', () => ({
  useTheme: function () {
    return { isDarkMode: false };
  },
}));

// jsdom does not implement ResizeObserver; use a class so `new` works,
// and fire the callback immediately so plotWidth/plotHeight become non-zero
beforeEach(() => {
  global.ResizeObserver = class {
    constructor(callback) {
      this._cb = callback;
    }
    observe() {
      this._cb([{ contentRect: { width: 800, height: 600 } }]);
    }
    disconnect() {}
  };
});

const INITIAL_Y_SCALE = 10; // must match the yScale useState default in EegViewer
const OVERDRAW = 2; // must match the OVERDRAW constant in EegViewer

const channelNames = ['EEG1', 'EEG2', 'EEG3'];
const data = [
  [0, 10, 20, 30], // timestamps — 30 s recording so tMax(30) ≥ 20 → windowSize initialises to 20
  [1, 2, 3, 4], // EEG1
  [4, 5, 6, 7], // EEG2
  [7, 8, 9, 10], // EEG3
];

const renderViewer = () => render(<EegViewer data={data} channelNames={channelNames} />);

// Helper: get the immediate flex-row container of an input
const containerOf = (input) => input.closest('div');

describe('EegViewer — controls presence', () => {
  it('renders the channel count input', () => {
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /number of channels/i });
    expect(input).toBeInTheDocument();
  });

  it('renders visible channels decrease (−) and increase (+) buttons', () => {
    renderViewer();
    const label2test = screen.getByText('Channels');
    expect(label2test).toBeInTheDocument();
    const buttons = within(containerOf(label2test)).getAllByRole('button');
    expect(buttons).toHaveLength(2);
  });

  it('renders visible channel count size input with default value of 20', () => {
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /window size/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(20);
  });

  it('renders the window size input with default value of 20', () => {
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /window size/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(20);
  });

  it('renders the Window Size label and its two buttons', () => {
    renderViewer();
    const label = screen.getByText('Window Size (s)');
    expect(label).toBeInTheDocument();
    const buttons = within(containerOf(label)).getAllByRole('button');
    expect(buttons).toHaveLength(2);
  });

  it('renders the shift step input with default value of 5', () => {
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /shift step/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(5);
  });

  it('renders the Time Shift label and its four buttons', () => {
    renderViewer();
    const label = screen.getByText('Time Shift (s)');
    expect(label).toBeInTheDocument();
    const buttons = within(containerOf(label)).getAllByRole('button');
    expect(buttons).toHaveLength(4);
  });

  it('renders the Gain label and its two buttons', () => {
    renderViewer();
    expect(screen.getByText('Gain (µV)')).toBeInTheDocument();
    const gainLabel = screen.getByText('Gain (µV)');
    const buttons = within(containerOf(gainLabel)).getAllByRole('button');
    expect(buttons).toHaveLength(2);
  });
});

describe('EegViewer — window size controls', () => {
  it('increases window size by 10 when + is clicked', async () => {
    const user = userEvent.setup();
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /window size/i });
    const increaseBtn = within(containerOf(input)).getByRole('button', {
      name: 'Increase window size',
    });

    await user.click(increaseBtn);

    expect(input).toHaveValue(30);
  });

  it('decreases window size by 10 when − is clicked', async () => {
    const user = userEvent.setup();
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /window size/i });
    const decreaseBtn = within(containerOf(input)).getByRole('button', {
      name: 'Decrease window size',
    });

    await user.click(decreaseBtn);

    expect(input).toHaveValue(10);
  });

  it('does not decrease window size below 1', async () => {
    const user = userEvent.setup();
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /window size/i });
    const decreaseBtn = within(containerOf(input)).getByRole('button', {
      name: 'Decrease window size',
    });

    // Drive value to 1 via the input, then try to go lower
    fireEvent.change(input, { target: { value: '1' } });
    await user.click(decreaseBtn);

    expect(input).toHaveValue(1);
  });

  it('updates window size when a value is typed into the input', () => {
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /window size/i });

    fireEvent.change(input, { target: { value: '30' } });

    expect(input).toHaveValue(30);
  });

  it('rounds window size to 1 decimal place on blur', () => {
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /window size/i });

    // "5.75" is 4 chars (fits the tMax=30 window limit); 5.75 × 10 = 57.5 → Math.round = 58 → / 10 = 5.8
    fireEvent.change(input, { target: { value: '5.75' } });
    fireEvent.blur(input);

    expect(input).toHaveValue(5.8);
  });

  it('does not increase window size beyond tMax via the + button', async () => {
    const user = userEvent.setup();
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /window size/i });
    const increaseBtn = within(containerOf(input)).getByRole('button', {
      name: 'Increase window size',
    });

    // Default windowSize=20, tMax=30. First click reaches 30 (the limit), second should stay there.
    await user.click(increaseBtn);
    await user.click(increaseBtn);

    expect(input).toHaveValue(30);
  });

  it('clamps startTime down when + button would push the window end beyond tMax', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    // Shift forward to startTime=10 using two > clicks (default step=5).
    // Window is then [10, 30] — right edge exactly touches tMax=30.
    const shiftInput = screen.getByRole('spinbutton', { name: /shift step/i });
    const shiftContainer = within(shiftInput.closest('div'));
    const forwardBtn = shiftContainer.getByRole('button', { name: 'Shift forward' });
    await user.click(forwardBtn); // > : startTime 0 → 5
    await user.click(forwardBtn); // > : startTime 5 → 10

    const windowInput = screen.getByRole('spinbutton', { name: /window size/i });
    const increaseBtn = within(containerOf(windowInput)).getByRole('button', {
      name: 'Increase window size',
    });

    UplotReactMock.mockClear();
    await user.click(increaseBtn); // tries windowSize 20→30; without fix startTime stays 10, end=40

    // The x-range end must not exceed tMax=30
    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[1]).toBeLessThanOrEqual(30);
  });

  it('clamps to tMax and rounds to 1 decimal on blur when value exceeds recording length', () => {
    // tMax has more than one decimal place — the bug was that tMax was used verbatim
    // (e.g. "30.123456") instead of being rounded to 1 decimal ("30.1")
    const dataWithDecimalTMax = [
      [0, 10, 20, 30.123456],
      [1, 2, 3, 4],
      [4, 5, 6, 7],
      [7, 8, 9, 10],
    ];
    render(<EegViewer data={dataWithDecimalTMax} channelNames={channelNames} />);
    const input = screen.getByRole('spinbutton', { name: /window size/i });

    // "31" is above tMax but fits in the 4-char limit (ceil(30.123456)="31" → length 2+2=4)
    fireEvent.change(input, { target: { value: '31' } });
    fireEvent.blur(input);

    // clamp to tMax=30.123456, then round: Math.round(30.123456 × 10) / 10 = 30.1
    expect(input).toHaveValue(30.1);
  });
});

describe('EegViewer — channel count controls', () => {
  it('decreases visible channel count when − is clicked', async () => {
    const user = userEvent.setup();
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /number of channels/i });
    const decreaseBtn = within(containerOf(input)).getByRole('button', {
      name: 'Show fewer channels',
    });

    fireEvent.change(input, { target: { value: String(channelNames.length) } });
    await user.click(decreaseBtn);

    expect(input).toHaveValue(channelNames.length - 1);
  });

  it('increases visible channel count when + is clicked', async () => {
    const user = userEvent.setup();
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /number of channels/i });
    const channelControls = within(containerOf(input));
    const increaseBtn = channelControls.getByRole('button', { name: 'Show more channels' });
    const decreaseBtn = channelControls.getByRole('button', { name: 'Show fewer channels' });

    await user.click(decreaseBtn);
    await user.click(increaseBtn);

    expect(input).toHaveValue(channelNames.length);
  });

  it('does not increase channel count above total number of channels', async () => {
    const user = userEvent.setup();
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /number of channels/i });
    const increaseBtn = within(containerOf(input)).getByRole('button', {
      name: 'Show more channels',
    });

    await user.click(increaseBtn);
    await user.click(increaseBtn);
    await user.click(increaseBtn);

    expect(input).toHaveValue(channelNames.length);
  });

  it('does not decrease channel count below 1', async () => {
    const user = userEvent.setup();
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /number of channels/i });
    const decreaseBtn = within(containerOf(input)).getByRole('button', {
      name: 'Show fewer channels',
    });

    fireEvent.change(input, { target: { value: '1' } });
    await user.click(decreaseBtn);

    expect(input).toHaveValue(1);
  });

  it('updates channel count when a value is typed into the input', () => {
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /number of channels/i });

    fireEvent.change(input, { target: { value: '2' } });

    expect(input).toHaveValue(2);
  });

  it('rounds visible channel count to nearest integer on blur', () => {
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /number of channels/i });

    // 2.5 → Math.round(2.5) = 3
    fireEvent.change(input, { target: { value: '2.5' } });
    fireEvent.blur(input);

    expect(input).toHaveValue(3);
  });
});

describe('EegViewer — start/end navigation', () => {
  const shiftControls = () => {
    const input = screen.getByRole('spinbutton', { name: /shift step/i });
    const scope = within(containerOf(input));
    return {
      jumpToStartBtn: scope.getByRole('button', { name: 'Jump to start' }),
      backwardBtn: scope.getByRole('button', { name: 'Shift backward' }),
      forwardBtn: scope.getByRole('button', { name: 'Shift forward' }),
      jumpToEndBtn: scope.getByRole('button', { name: 'Jump to end' }),
    };
  };

  it('|< resets start time to 0', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();
    const { jumpToStartBtn, forwardBtn } = shiftControls();

    await user.click(forwardBtn); // > to move away from 0
    UplotReactMock.mockClear();
    await user.click(jumpToStartBtn); // |<

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[0]).toBe(0);
  });

  it('>| sets the window end to the last timestamp of the recording', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();
    const { jumpToEndBtn } = shiftControls();

    UplotReactMock.mockClear();
    await user.click(jumpToEndBtn); // >|

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    const lastTimestamp = data[0][data[0].length - 1];
    // range[1] = startTime + windowSize = (lastTs - windowSize) + windowSize = lastTs
    expect(range[1]).toBeCloseTo(lastTimestamp, 5);
  });

  it('> shifts start time forward by the default shift step (5)', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();
    const { forwardBtn } = shiftControls();

    UplotReactMock.mockClear();
    await user.click(forwardBtn); // >

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[0]).toBe(5);
  });

  it('< shifts start time backward by the default shift step', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();
    const { backwardBtn, forwardBtn } = shiftControls();

    await user.click(forwardBtn); // > to move away from 0
    UplotReactMock.mockClear();
    await user.click(backwardBtn); // <

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[0]).toBe(0);
  });

  it('< clamps start time at 0', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();
    const { backwardBtn, forwardBtn } = shiftControls();

    await user.click(forwardBtn); // > advance to 5
    await user.click(backwardBtn); // < back to 0
    await user.click(backwardBtn); // < try to go below 0 — state unchanged, no re-render

    // Last render (from the first < click) had startTime=0
    const lastRange = UplotReactMock.mock.calls.at(-1)[0].options.scales.x.range;
    expect(lastRange[0]).toBe(0);
  });
});

describe('EegViewer — shift step size effect', () => {
  it('changing the shift step changes the jump distance of the > button', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    const shiftInput = screen.getByRole('spinbutton', { name: /shift step/i });
    fireEvent.change(shiftInput, { target: { value: '10' } });

    const forwardBtn = within(containerOf(shiftInput)).getByRole('button', {
      name: 'Shift forward',
    });
    UplotReactMock.mockClear();
    await user.click(forwardBtn); // >

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[0]).toBe(10);
  });
});

describe('EegViewer — shift step controls', () => {
  it('updates shift step when a value is typed into the input', () => {
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /shift step/i });

    fireEvent.change(input, { target: { value: '5' } });

    expect(input).toHaveValue(5);
  });

  it('does not allow shift step below 1', () => {
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /shift step/i });

    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);

    expect(input).toHaveValue(1);
  });

  it('rounds shift step to 1 decimal place on blur', () => {
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /shift step/i });

    // 3.25 × 10 = 32.5 → Math.round = 33 → / 10 = 3.3
    fireEvent.change(input, { target: { value: '3.25' } });
    fireEvent.blur(input);

    expect(input).toHaveValue(3.3);
  });
});

describe('EegViewer — plot rendering', () => {
  it('renders one plot per channel when the container has a measured size', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    UplotReactMock.mockClear();

    renderViewer();

    // +1 for the fixed x-axis strip rendered below the scroll area
    expect(UplotReactMock).toHaveBeenCalledTimes(channelNames.length + 1);
  });

  it('renders a label overlay for each channel name', () => {
    renderViewer();

    for (const name of channelNames) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it('all channel plots hide their x-axis (it is shown in the fixed strip instead)', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    UplotReactMock.mockClear();

    renderViewer();

    // The first N calls are channel plots (axes[0].show === false).
    // The last call is the fixed x-axis strip (axes[0].show is undefined/truthy).
    const channelCalls = UplotReactMock.mock.calls.slice(0, channelNames.length);
    const xAxisVisibility = channelCalls.map((call) => call[0].options.axes[0].show);
    expect(xAxisVisibility).toEqual([false, false, false]);
  });

  it('all channels receive the same initial y-range', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    UplotReactMock.mockClear();

    renderViewer();

    const channelCalls = UplotReactMock.mock.calls.slice(0, channelNames.length);
    const yRanges = channelCalls.map((call) => call[0].options.scales.y.range);
    yRanges.forEach((range) =>
      expect(range).toEqual([-INITIAL_Y_SCALE * OVERDRAW, INITIAL_Y_SCALE * OVERDRAW])
    );
  });
});

describe('EegViewer — gain controls', () => {
  it('zoom in button halves the plot y-range', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    const zoomInBtn = within(containerOf(screen.getByText('Gain (µV)'))).getByRole('button', {
      name: 'Zoom in',
    });
    UplotReactMock.mockClear();
    await user.click(zoomInBtn);

    const [yMin, yMax] = UplotReactMock.mock.calls[0][0].options.scales.y.range;
    expect(yMin).toBeCloseTo((-INITIAL_Y_SCALE / 2) * OVERDRAW, 3);
    expect(yMax).toBeCloseTo((INITIAL_Y_SCALE / 2) * OVERDRAW, 3);
  });

  it('zoom out button doubles the plot y-range', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    const zoomOutBtn = within(containerOf(screen.getByText('Gain (µV)'))).getByRole('button', {
      name: 'Zoom out',
    });
    UplotReactMock.mockClear();
    await user.click(zoomOutBtn);

    const [yMin, yMax] = UplotReactMock.mock.calls[0][0].options.scales.y.range;
    expect(yMin).toBeCloseTo(-INITIAL_Y_SCALE * 2 * OVERDRAW, 3);
    expect(yMax).toBeCloseTo(INITIAL_Y_SCALE * 2 * OVERDRAW, 3);
  });

  it('zoom in rounds plot y-range to nearest 0.001', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    // Set gain to 0.003 so halving gives 0.0015, which rounds to 0.002 at 3dp
    fireEvent.change(screen.getByRole('spinbutton', { name: /gain/i }), {
      target: { value: '0.003' },
    });

    const zoomInBtn = within(containerOf(screen.getByText('Gain (µV)'))).getByRole('button', {
      name: 'Zoom in',
    });
    UplotReactMock.mockClear();
    await user.click(zoomInBtn);

    const [yMin, yMax] = UplotReactMock.mock.calls[0][0].options.scales.y.range;
    // 0.003 / 2 = 0.0015 → Math.round(0.0015 × 1000) / 1000 = 2/1000 = 0.002
    expect(yMin).toBe(-0.002 * OVERDRAW);
    expect(yMax).toBe(0.002 * OVERDRAW);
  });

  it('clamps gain to GAIN_MIN (0.001) on blur when 0 is entered', () => {
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /gain/i });

    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);

    expect(input).toHaveValue(0.001);
  });

  it('all channels share the same y-range after gain change', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    const zoomInBtn = within(containerOf(screen.getByText('Gain (µV)'))).getByRole('button', {
      name: 'Zoom in',
    });
    UplotReactMock.mockClear();
    await user.click(zoomInBtn);

    const channelCalls = UplotReactMock.mock.calls.slice(0, channelNames.length);
    const yRanges = channelCalls.map((call) => call[0].options.scales.y.range);
    yRanges.forEach((range) => expect(range).toEqual(yRanges[0]));
  });

  it('does not increase gain beyond 99999 via the ZoomOut button', async () => {
    const user = userEvent.setup();
    renderViewer();
    const gainInput = screen.getByRole('spinbutton', { name: /gain/i });
    const zoomOutBtn = within(containerOf(screen.getByText('Gain (µV)'))).getByRole('button', {
      name: 'Zoom out',
    });

    // Set gain to 99999 (the 5-digit max), then click ZoomOut — which doubles to 199998 without a cap
    fireEvent.change(gainInput, { target: { value: '99999' } });
    await user.click(zoomOutBtn);

    expect(gainInput).toHaveValue(99999);
  });

  it('does not decrease gain below GAIN_MIN (0.001) via the Zoom in button', async () => {
    const user = userEvent.setup();
    renderViewer();
    const gainInput = screen.getByRole('spinbutton', { name: /gain/i });
    const zoomInBtn = within(containerOf(screen.getByText('Gain (µV)'))).getByRole('button', {
      name: 'Zoom in',
    });

    // Set gain to 0.001 (GAIN_MIN), then click Zoom in — which would halve to 0.0005 without a clamp
    fireEvent.change(gainInput, { target: { value: '0.001' } });
    await user.click(zoomInBtn);

    expect(gainInput).toHaveValue(0.001);
  });
});

describe('EegViewer — timeline scrubber', () => {
  // Make requestAnimationFrame synchronous so drag callbacks fire immediately in tests
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      cb();
      return 0;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // tMax=30, windowSize=20 (initial), startTime=0 (initial)
  const scrubber = () => screen.getByTestId('timeline-scrubber');
  const thumb = () => screen.getByTestId('timeline-thumb');

  const mockScrubberWidth = (el, width = 300) =>
    Object.defineProperty(el, 'offsetWidth', { configurable: true, value: width });

  it('renders the thumb at position 0 with width proportional to windowSize', () => {
    renderViewer();
    expect(thumb().style.left).toBe('0%');
    // windowSize=20, tMax=30 → 66.67%
    expect(parseFloat(thumb().style.width)).toBeCloseTo(66.67, 1);
  });

  it('clicking the bar jumps start time to the clicked position', () => {
    renderViewer();
    vi.spyOn(scrubber(), 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 300,
      top: 0,
      bottom: 12,
      right: 300,
      height: 12,
    });
    // clientX=150 on 300px bar: ratio=0.5 → startTime = max(0, min(10, 0.5×30 − 10)) = 5
    fireEvent.mouseDown(scrubber(), { clientX: 150 });
    // left = 5/30 ≈ 16.67%
    expect(parseFloat(thumb().style.left)).toBeCloseTo(16.67, 1);
  });

  it('dragging the thumb moves the window forward', () => {
    renderViewer();
    mockScrubberWidth(scrubber());
    // startX=0, startTime=0, windowSize=20
    fireEvent.mouseDown(thumb(), { clientX: 0 });
    // move 100px → dt=(100/300)×30=10 → startTime=min(10,10)=10
    act(() => {
      fireEvent.mouseMove(window, { clientX: 100 });
    });
    // left = 10/30 ≈ 33.33%
    expect(parseFloat(thumb().style.left)).toBeCloseTo(33.33, 1);
    act(() => {
      fireEvent.mouseUp(window);
    });
  });

  it('dragging the thumb clamps start time at 0', () => {
    renderViewer();
    mockScrubberWidth(scrubber());
    fireEvent.mouseDown(thumb(), { clientX: 100 });
    // move left past 0 → dt negative → clamped to 0
    act(() => {
      fireEvent.mouseMove(window, { clientX: -200 });
    });
    expect(parseFloat(thumb().style.left)).toBe(0);
    act(() => {
      fireEvent.mouseUp(window);
    });
  });

  it('dragging the right handle increases window size', () => {
    renderViewer();
    mockScrubberWidth(scrubber());
    // startX=0, startTime=0, windowSize=20
    fireEvent.mouseDown(screen.getByTestId('timeline-resize-right'), { clientX: 0 });
    // move 60px → dt=(60/300)×30=6 → windowSize=min(30,26)=26
    act(() => {
      fireEvent.mouseMove(window, { clientX: 60 });
    });
    // width = 26/30 ≈ 86.67%
    expect(parseFloat(thumb().style.width)).toBeCloseTo(86.67, 1);
    act(() => {
      fireEvent.mouseUp(window);
    });
  });

  it('dragging the left handle shrinks the window from the left', () => {
    renderViewer();
    mockScrubberWidth(scrubber());
    // startX=0, startTime=0, windowSize=20
    fireEvent.mouseDown(screen.getByTestId('timeline-resize-left'), { clientX: 0 });
    // move 30px → dt=(30/300)×30=3 → newStart=min(19,3)=3, newWindowSize=20-3=17
    act(() => {
      fireEvent.mouseMove(window, { clientX: 30 });
    });
    expect(parseFloat(thumb().style.left)).toBeCloseTo(10, 1); // 3/30=10%
    expect(parseFloat(thumb().style.width)).toBeCloseTo(56.67, 1); // 17/30≈56.67%
    act(() => {
      fireEvent.mouseUp(window);
    });
  });

  it('dragging the right handle updates the window size input', () => {
    renderViewer();
    mockScrubberWidth(scrubber());
    const windowInput = screen.getByRole('spinbutton', { name: /window size/i });

    fireEvent.mouseDown(screen.getByTestId('timeline-resize-right'), { clientX: 0 });
    // move 60px → dt=(60/300)×30=6 → windowSize=min(30,26)=26
    act(() => {
      fireEvent.mouseMove(window, { clientX: 60 });
    });

    expect(windowInput).toHaveValue(26);
    act(() => {
      fireEvent.mouseUp(window);
    });
  });

  it('dragging the left handle updates the window size input', () => {
    renderViewer();
    mockScrubberWidth(scrubber());
    const windowInput = screen.getByRole('spinbutton', { name: /window size/i });

    fireEvent.mouseDown(screen.getByTestId('timeline-resize-left'), { clientX: 0 });
    // move 30px → dt=(30/300)×30=3 → newStart=3, newWindowSize=20-3=17
    act(() => {
      fireEvent.mouseMove(window, { clientX: 30 });
    });

    expect(windowInput).toHaveValue(17);
    act(() => {
      fireEvent.mouseUp(window);
    });
  });

  it('dragging the thumb clamps start time at tMax − windowSize', () => {
    renderViewer();
    mockScrubberWidth(scrubber());

    fireEvent.mouseDown(thumb(), { clientX: 0 });
    // move far right → dt >> tMax-windowSize → clamped to 10
    act(() => {
      fireEvent.mouseMove(window, { clientX: 600 });
    });

    // left = 10/30 ≈ 33.33%
    expect(parseFloat(thumb().style.left)).toBeCloseTo(33.33, 1);
    act(() => {
      fireEvent.mouseUp(window);
    });
  });

  it('dragging the right handle clamps windowSize at tMax', () => {
    renderViewer();
    mockScrubberWidth(scrubber());

    fireEvent.mouseDown(screen.getByTestId('timeline-resize-right'), { clientX: 0 });
    // move far right → windowSize clamped to tMax=30
    act(() => {
      fireEvent.mouseMove(window, { clientX: 600 });
    });

    expect(parseFloat(thumb().style.width)).toBeCloseTo(100, 1);
    act(() => {
      fireEvent.mouseUp(window);
    });
  });

  it('dragging the left handle clamps windowSize to a minimum of 1', () => {
    renderViewer();
    mockScrubberWidth(scrubber());

    fireEvent.mouseDown(screen.getByTestId('timeline-resize-left'), { clientX: 0 });
    // move far right → newStart clamped to st+sw-1=19, newWindowSize=20-19=1
    act(() => {
      fireEvent.mouseMove(window, { clientX: 600 });
    });

    expect(parseFloat(thumb().style.width)).toBeCloseTo((1 / 30) * 100, 1);
    act(() => {
      fireEvent.mouseUp(window);
    });
  });

  it('mouseup stops the drag — further moves have no effect', () => {
    renderViewer();
    mockScrubberWidth(scrubber());
    fireEvent.mouseDown(thumb(), { clientX: 0 });
    act(() => {
      fireEvent.mouseMove(window, { clientX: 100 });
    }); // startTime → 10
    act(() => {
      fireEvent.mouseUp(window);
    });
    const leftAfterRelease = thumb().style.left;
    act(() => {
      fireEvent.mouseMove(window, { clientX: 200 });
    }); // should have no effect
    expect(thumb().style.left).toBe(leftAfterRelease);
  });
});

describe('EegViewer — shift step capped by window size', () => {
  it('shift step input has max attribute equal to the current window size', () => {
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /shift step/i });
    // default windowSize = 20
    expect(input).toHaveAttribute('max', '20');
  });

  it('shift step clamps to window size on blur when the typed value exceeds it', () => {
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /shift step/i });

    fireEvent.change(input, { target: { value: '25' } }); // 25 > windowSize=20
    fireEvent.blur(input);

    expect(input).toHaveValue(20);
  });

  it('decreasing window size clamps an oversized shift step down to the new window size', async () => {
    const user = userEvent.setup();
    renderViewer();
    const shiftInput = screen.getByRole('spinbutton', { name: /shift step/i });
    const windowInput = screen.getByRole('spinbutton', { name: /window size/i });

    // Set shift step to 15 (valid while window = 20)
    fireEvent.change(shiftInput, { target: { value: '15' } });

    // Decrease window size from 20 to 10 via the − button (step = 10)
    const decreaseWindowBtn = within(containerOf(windowInput)).getByRole('button', {
      name: 'Decrease window size',
    });
    await user.click(decreaseWindowBtn);

    expect(shiftInput).toHaveValue(10);
  });

  it('shift step max attribute updates when window size changes', async () => {
    const user = userEvent.setup();
    renderViewer();
    const shiftInput = screen.getByRole('spinbutton', { name: /shift step/i });
    const windowInput = screen.getByRole('spinbutton', { name: /window size/i });

    const decreaseWindowBtn = within(containerOf(windowInput)).getByRole('button', {
      name: 'Decrease window size',
    });
    await user.click(decreaseWindowBtn); // 20 → 10

    expect(shiftInput).toHaveAttribute('max', '10');
  });
});

describe('EegViewer — keyboard navigation', () => {
  // tMax=30, windowSize=20 (initial), startTime=0 (initial), shiftTimeStepSize=5 (initial)
  const viewer = () => screen.getByTestId('eeg-viewer-container');

  it('renders a keyboard shortcuts hint with a tooltip', () => {
    renderViewer();
    expect(screen.getByTitle(/keyboard navigation/i)).toBeInTheDocument();
  });

  it('clicking the viewer background focuses it', () => {
    renderViewer();
    fireEvent.mouseDown(viewer());
    expect(viewer()).toHaveFocus();
  });

  it('clicking a button does not move focus to the viewer container', async () => {
    const user = userEvent.setup();
    renderViewer();
    const zoomInBtn = within(containerOf(screen.getByText('Gain (µV)'))).getByRole('button', {
      name: 'Zoom in',
    });

    await user.click(zoomInBtn);

    expect(viewer()).not.toHaveFocus();
  });

  it('ArrowUp halves the gain (zoom in)', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    renderViewer();

    UplotReactMock.mockClear();
    fireEvent.keyDown(viewer(), { key: 'ArrowUp' });

    const [yMin, yMax] = UplotReactMock.mock.calls[0][0].options.scales.y.range;
    expect(yMin).toBeCloseTo((-INITIAL_Y_SCALE / 2) * OVERDRAW, 3);
    expect(yMax).toBeCloseTo((INITIAL_Y_SCALE / 2) * OVERDRAW, 3);
  });

  it('ArrowDown doubles the gain (zoom out)', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    renderViewer();

    UplotReactMock.mockClear();
    fireEvent.keyDown(viewer(), { key: 'ArrowDown' });

    const [yMin, yMax] = UplotReactMock.mock.calls[0][0].options.scales.y.range;
    expect(yMin).toBeCloseTo(-INITIAL_Y_SCALE * 2 * OVERDRAW, 3);
    expect(yMax).toBeCloseTo(INITIAL_Y_SCALE * 2 * OVERDRAW, 3);
  });

  it('ArrowRight pans forward by the shift step', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    renderViewer();

    UplotReactMock.mockClear();
    fireEvent.keyDown(viewer(), { key: 'ArrowRight' });

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[0]).toBe(5);
  });

  it('ArrowLeft pans backward by the shift step', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    renderViewer();

    fireEvent.keyDown(viewer(), { key: 'ArrowRight' }); // startTime 0 → 5
    UplotReactMock.mockClear();
    fireEvent.keyDown(viewer(), { key: 'ArrowLeft' }); // startTime 5 → 0

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[0]).toBe(0);
  });

  it('PageDown jumps forward by one window, clamped to tMax − windowSize', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    renderViewer();

    UplotReactMock.mockClear();
    fireEvent.keyDown(viewer(), { key: 'PageDown' });

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[0]).toBe(10); // min(tMax-windowSize, 0+windowSize) = min(10, 20) = 10
    expect(range[1]).toBe(30);
  });

  it('PageUp jumps backward by one window, clamped at 0', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    renderViewer();

    fireEvent.keyDown(viewer(), { key: 'PageDown' }); // startTime 0 → 10
    UplotReactMock.mockClear();
    fireEvent.keyDown(viewer(), { key: 'PageUp' }); // startTime 10 → 0

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[0]).toBe(0);
  });

  it('Home jumps to the beginning of the recording', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    renderViewer();

    fireEvent.keyDown(viewer(), { key: 'ArrowRight' }); // startTime 0 → 5
    UplotReactMock.mockClear();
    fireEvent.keyDown(viewer(), { key: 'Home' });

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[0]).toBe(0);
  });

  it('End jumps to the end of the recording', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    renderViewer();

    UplotReactMock.mockClear();
    fireEvent.keyDown(viewer(), { key: 'End' });

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    const lastTimestamp = data[0][data[0].length - 1];
    expect(range[1]).toBeCloseTo(lastTimestamp, 5);
  });

  it('does not respond to keyboard shortcuts while an input is focused', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    renderViewer();
    const gainInput = screen.getByRole('spinbutton', { name: /gain/i });

    UplotReactMock.mockClear();
    fireEvent.keyDown(gainInput, { key: 'ArrowUp' });

    expect(UplotReactMock).not.toHaveBeenCalled();
  });
});

describe('EegViewer — time shift clamping', () => {
  // tMax=30, windowSize=20 → valid startTime range is [0, 10]
  const shiftControls = () => {
    const input = screen.getByRole('spinbutton', { name: /shift step/i });
    const scope = within(input.closest('div'));
    return {
      backwardBtn: scope.getByRole('button', { name: 'Shift backward' }),
      forwardBtn: scope.getByRole('button', { name: 'Shift forward' }),
    };
  };

  it('forward shift clamps at tMax − windowSize', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    // Set a step large enough to overshoot in one click (25 > tMax−windowSize=10)
    fireEvent.change(screen.getByRole('spinbutton', { name: /shift step/i }), {
      target: { value: '25' },
    });

    const { forwardBtn } = shiftControls();
    UplotReactMock.mockClear();
    await user.click(forwardBtn); // >

    // startTime should be clamped at tMax − windowSize = 10, not 25
    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[0]).toBe(10);
    expect(range[1]).toBe(30); // startTime + windowSize = 10 + 20
  });

  it('clicking forward when already at tMax − windowSize causes no re-render', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();
    const { forwardBtn } = shiftControls();

    // step=5: two clicks reach the ceiling (0 → 5 → 10 = tMax − windowSize)
    await user.click(forwardBtn);
    await user.click(forwardBtn);

    // Third click: clamped value equals current state → React skips re-render
    UplotReactMock.mockClear();
    await user.click(forwardBtn);
    expect(UplotReactMock).not.toHaveBeenCalled();
  });

  it('backward shift clamps at 0', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();
    const { backwardBtn, forwardBtn } = shiftControls();

    // Set a step large enough to undershoot in one click from any position
    fireEvent.change(screen.getByRole('spinbutton', { name: /shift step/i }), {
      target: { value: '25' },
    });
    await user.click(forwardBtn); // first move forward so < has somewhere to go

    UplotReactMock.mockClear();
    await user.click(backwardBtn); // <

    // startTime should be clamped at 0, not negative
    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[0]).toBe(0);
    expect(range[1]).toBe(20); // 0 + windowSize
  });
});
