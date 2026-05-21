import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
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

  it('renders channel decrease (−) and increase (+) buttons', () => {
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /number of channels/i });
    const buttons = within(containerOf(input)).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent('−');
    expect(buttons[1]).toHaveTextContent('+');
  });

  it('renders the window size input with default value of 20', () => {
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /window size/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(20);
  });

  it('renders window size decrease (−) and increase (+) buttons', () => {
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /window size/i });
    const buttons = within(containerOf(input)).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent('−');
    expect(buttons[1]).toHaveTextContent('+');
  });

  it('renders the shift step input with default value of 5', () => {
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /shift step/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(5);
  });

  it('renders all four shift buttons in order: |< < > >|', () => {
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /shift step/i });
    const buttons = within(containerOf(input)).getAllByRole('button');
    expect(buttons).toHaveLength(4);
    expect(buttons[0]).toHaveTextContent('|<');
    expect(buttons[1]).toHaveTextContent('<');
    expect(buttons[2]).toHaveTextContent('>');
    expect(buttons[3]).toHaveTextContent('>|');
  });

  it('renders the Zoom label and its two buttons', () => {
    renderViewer();
    expect(screen.getByText('Zoom')).toBeInTheDocument();
    const zoomLabel = screen.getByText('Zoom');
    const buttons = within(containerOf(zoomLabel)).getAllByRole('button');
    expect(buttons).toHaveLength(2);
  });
});

describe('EegViewer — window size controls', () => {
  it('increases window size by 1 when + is clicked', async () => {
    const user = userEvent.setup();
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /window size/i });
    const [, increaseBtn] = within(containerOf(input)).getAllByRole('button');

    await user.click(increaseBtn);

    expect(input).toHaveValue(21);
  });

  it('decreases window size by 1 when − is clicked', async () => {
    const user = userEvent.setup();
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /window size/i });
    const [decreaseBtn] = within(containerOf(input)).getAllByRole('button');

    await user.click(decreaseBtn);

    expect(input).toHaveValue(19);
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

    expect(input).toHaveValue(1);
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

  it('all channels receive the same initial y-range of [-100, 100]', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    UplotReactMock.mockClear();

    renderViewer();

    const channelCalls = UplotReactMock.mock.calls.slice(0, channelNames.length);
    const yRanges = channelCalls.map((call) => call[0].options.scales.y.range);
    yRanges.forEach((range) => expect(range).toEqual([-100, 100]));
  });
});

describe('EegViewer — zoom controls', () => {
  it('zoom + shrinks the y-range (zoom in)', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    const [, zoomInBtn] = within(containerOf(screen.getByText('Zoom'))).getAllByRole('button');
    UplotReactMock.mockClear();
    await user.click(zoomInBtn);

    const [lo, hi] = UplotReactMock.mock.calls[0][0].options.scales.y.range;
    expect(lo).toBeCloseTo(-100 / 1.5, 3);
    expect(hi).toBeCloseTo(100 / 1.5, 3);
  });

  it('zoom − expands the y-range (zoom out)', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    const [zoomOutBtn] = within(containerOf(screen.getByText('Zoom'))).getAllByRole('button');
    UplotReactMock.mockClear();
    await user.click(zoomOutBtn);

    const [lo, hi] = UplotReactMock.mock.calls[0][0].options.scales.y.range;
    expect(lo).toBeCloseTo(-100 * 1.5, 3);
    expect(hi).toBeCloseTo(100 * 1.5, 3);
  });

  it('all channels share the same y-range after zooming', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    renderViewer();

    const [, zoomInBtn] = within(containerOf(screen.getByText('Zoom'))).getAllByRole('button');
    UplotReactMock.mockClear();
    await user.click(zoomInBtn);

    const channelCalls = UplotReactMock.mock.calls.slice(0, channelNames.length);
    const yRanges = channelCalls.map((call) => call[0].options.scales.y.range);
    yRanges.forEach((range) => expect(range).toEqual(yRanges[0]));
  });
});
