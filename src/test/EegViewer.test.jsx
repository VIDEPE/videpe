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
    const [, increaseBtn] = within(containerOf(input)).getAllByRole('button');

    await user.click(increaseBtn);

    expect(input).toHaveValue(30);
  });

  it('decreases window size by 10 when − is clicked', async () => {
    const user = userEvent.setup();
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /window size/i });
    const [decreaseBtn] = within(containerOf(input)).getAllByRole('button');

    await user.click(decreaseBtn);

    expect(input).toHaveValue(10);
  });

  it('does not decrease window size below 1', async () => {
    const user = userEvent.setup();
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /window size/i });
    const [decreaseBtn] = within(containerOf(input)).getAllByRole('button');

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
    const [, increaseBtn] = within(containerOf(input)).getAllByRole('button');

    // Default windowSize=20, tMax=30. First click reaches 30 (the limit), second should stay there.
    await user.click(increaseBtn);
    await user.click(increaseBtn);

    expect(input).toHaveValue(30);
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
    const [decreaseBtn] = within(containerOf(input)).getAllByRole('button');

    fireEvent.change(input, { target: { value: String(channelNames.length) } });
    await user.click(decreaseBtn);

    expect(input).toHaveValue(channelNames.length - 1);
  });

  it('increases visible channel count when + is clicked', async () => {
    const user = userEvent.setup();
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /number of channels/i });
    const [decreaseBtn, increaseBtn] = within(containerOf(input)).getAllByRole('button');

    await user.click(decreaseBtn);
    await user.click(increaseBtn);

    expect(input).toHaveValue(channelNames.length);
  });

  it('does not increase channel count above total number of channels', async () => {
    const user = userEvent.setup();
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /number of channels/i });
    const [, increaseBtn] = within(containerOf(input)).getAllByRole('button');

    await user.click(increaseBtn);
    await user.click(increaseBtn);
    await user.click(increaseBtn);

    expect(input).toHaveValue(channelNames.length);
  });

  it('does not decrease channel count below 1', async () => {
    const user = userEvent.setup();
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /number of channels/i });
    const [decreaseBtn] = within(containerOf(input)).getAllByRole('button');

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
  const shiftButtons = () => {
    const input = screen.getByRole('spinbutton', { name: /shift step/i });
    return within(containerOf(input)).getAllByRole('button');
    // order: [|<,  <,  >,  >|]
  };

  it('|< resets start time to 0', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    await user.click(shiftButtons()[2]); // > to move away from 0
    UplotReactMock.mockClear();
    await user.click(shiftButtons()[0]); // |<

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[0]).toBe(0);
  });

  it('>| sets the window end to the last timestamp of the recording', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    UplotReactMock.mockClear();
    await user.click(shiftButtons()[3]); // >|

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    const lastTimestamp = data[0][data[0].length - 1];
    // range[1] = startTime + windowSize = (lastTs - windowSize) + windowSize = lastTs
    expect(range[1]).toBeCloseTo(lastTimestamp, 5);
  });

  it('> shifts start time forward by the default shift step (5)', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    UplotReactMock.mockClear();
    await user.click(shiftButtons()[2]); // >

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[0]).toBe(5);
  });

  it('< shifts start time backward by the default shift step', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    await user.click(shiftButtons()[2]); // > to move away from 0
    UplotReactMock.mockClear();
    await user.click(shiftButtons()[1]); // <

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[0]).toBe(0);
  });

  it('< clamps start time at 0', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    await user.click(shiftButtons()[2]); // > advance to 5
    await user.click(shiftButtons()[1]); // < back to 0
    await user.click(shiftButtons()[1]); // < try to go below 0 — state unchanged, no re-render

    // Last render (from the first < click) had startTime=0
    const lastRange = UplotReactMock.mock.calls.at(-1)[0].options.scales.x.range;
    expect(lastRange[0]).toBe(0);
  });
});

describe('EegViewer — shift step size effect', () => {
  const shiftButtons = () => {
    const input = screen.getByRole('spinbutton', { name: /shift step/i });
    return within(containerOf(input)).getAllByRole('button');
    // order: [|<, <, >, >|]
  };

  it('changing the shift step changes the jump distance of the > button', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    fireEvent.change(screen.getByRole('spinbutton', { name: /shift step/i }), {
      target: { value: '10' },
    });

    UplotReactMock.mockClear();
    await user.click(shiftButtons()[2]); // >

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
  it('gain + halves the y-range (increase gain)', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    const [, gainUpBtn] = within(containerOf(screen.getByText('Gain (µV)'))).getAllByRole('button');
    UplotReactMock.mockClear();
    await user.click(gainUpBtn);

    const [lo, hi] = UplotReactMock.mock.calls[0][0].options.scales.y.range;
    expect(lo).toBeCloseTo((-INITIAL_Y_SCALE / 2) * OVERDRAW, 3);
    expect(hi).toBeCloseTo((INITIAL_Y_SCALE / 2) * OVERDRAW, 3);
  });

  it('gain − doubles the y-range (decrease gain)', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    const [gainDownBtn] = within(containerOf(screen.getByText('Gain (µV)'))).getAllByRole('button');
    UplotReactMock.mockClear();
    await user.click(gainDownBtn);

    const [lo, hi] = UplotReactMock.mock.calls[0][0].options.scales.y.range;
    expect(lo).toBeCloseTo(-INITIAL_Y_SCALE * 2 * OVERDRAW, 3);
    expect(hi).toBeCloseTo(INITIAL_Y_SCALE * 2 * OVERDRAW, 3);
  });

  it('gain + rounds the halved y-scale to the nearest integer', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    // Set gain to 5 so halving gives 2.5, which Math.round rounds up to 3
    fireEvent.change(screen.getByRole('spinbutton', { name: /gain/i }), {
      target: { value: '5' },
    });

    const [, gainUpBtn] = within(containerOf(screen.getByText('Gain (µV)'))).getAllByRole('button');
    UplotReactMock.mockClear();
    await user.click(gainUpBtn);

    const [lo, hi] = UplotReactMock.mock.calls[0][0].options.scales.y.range;
    // 5 / 2 = 2.5 → Math.round(2.5) = 3, not 2 or 2.5
    expect(lo).toBe(-3 * OVERDRAW);
    expect(hi).toBe(3 * OVERDRAW);
  });

  it('rounds gain to nearest integer on blur', () => {
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /gain/i });

    // 3.5 → Math.round(3.5) = 4
    fireEvent.change(input, { target: { value: '3.5' } });
    fireEvent.blur(input);

    expect(input).toHaveValue(4);
  });

  it('all channels share the same y-range after gain change', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    const [, gainUpBtn] = within(containerOf(screen.getByText('Gain (µV)'))).getAllByRole('button');
    UplotReactMock.mockClear();
    await user.click(gainUpBtn);

    const channelCalls = UplotReactMock.mock.calls.slice(0, channelNames.length);
    const yRanges = channelCalls.map((call) => call[0].options.scales.y.range);
    yRanges.forEach((range) => expect(range).toEqual(yRanges[0]));
  });

  it('does not increase gain beyond 99999 via the ZoomOut button', async () => {
    const user = userEvent.setup();
    renderViewer();
    const gainInput = screen.getByRole('spinbutton', { name: /gain/i });
    const [gainDownBtn] = within(containerOf(screen.getByText('Gain (µV)'))).getAllByRole('button');

    // Set gain to 99999 (the 5-digit max), then click ZoomOut — which doubles to 199998 without a cap
    fireEvent.change(gainInput, { target: { value: '99999' } });
    await user.click(gainDownBtn);

    expect(gainInput).toHaveValue(99999);
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

describe('EegViewer — time shift clamping', () => {
  // tMax=30, windowSize=20 → valid startTime range is [0, 10]
  const shiftButtons = () => {
    const input = screen.getByRole('spinbutton', { name: /shift step/i });
    return within(input.closest('div')).getAllByRole('button');
    // order: [|<, <, >, >|]
  };

  it('forward shift clamps at tMax − windowSize', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    // Set a step large enough to overshoot in one click (25 > tMax−windowSize=10)
    fireEvent.change(screen.getByRole('spinbutton', { name: /shift step/i }), {
      target: { value: '25' },
    });

    UplotReactMock.mockClear();
    await user.click(shiftButtons()[2]); // >

    // startTime should be clamped at tMax − windowSize = 10, not 25
    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[0]).toBe(10);
    expect(range[1]).toBe(30); // startTime + windowSize = 10 + 20
  });

  it('clicking forward when already at tMax − windowSize causes no re-render', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    // step=5: two clicks reach the ceiling (0 → 5 → 10 = tMax − windowSize)
    await user.click(shiftButtons()[2]);
    await user.click(shiftButtons()[2]);

    // Third click: clamped value equals current state → React skips re-render
    UplotReactMock.mockClear();
    await user.click(shiftButtons()[2]);
    expect(UplotReactMock).not.toHaveBeenCalled();
  });

  it('backward shift clamps at 0', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    // Set a step large enough to undershoot in one click from any position
    fireEvent.change(screen.getByRole('spinbutton', { name: /shift step/i }), {
      target: { value: '25' },
    });
    await user.click(shiftButtons()[2]); // first move forward so < has somewhere to go

    UplotReactMock.mockClear();
    await user.click(shiftButtons()[1]); // <

    // startTime should be clamped at 0, not negative
    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[0]).toBe(0);
    expect(range[1]).toBe(20); // 0 + windowSize
  });
});
