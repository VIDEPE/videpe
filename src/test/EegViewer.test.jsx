import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EegViewer } from '@/components/EegViewer';

vi.mock('uplot-react', () => {
  const UplotReactMock = vi.fn(function () { return null; });
  return { default: UplotReactMock };
});

vi.mock('@/components/ThemeContext', () => ({
  useTheme: function () { return { isDarkMode: false }; },
}));

// jsdom does not implement ResizeObserver; use a class so `new` works,
// and fire the callback immediately so plotWidth/plotHeight become non-zero
beforeEach(() => {
  global.ResizeObserver = class {
    constructor(callback) { this._cb = callback; }
    observe() { this._cb([{ contentRect: { width: 800, height: 600 } }]); }
    disconnect() {}
  };
});

const channelNames = ['EEG1', 'EEG2', 'EEG3'];
const data = [
  [0, 0.01, 0.02],   // timestamps
  [1, 2, 3],         // EEG1
  [4, 5, 6],         // EEG2
  [7, 8, 9],         // EEG3
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

  it('renders the shift step input with default value of 1', () => {
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /shift step/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(1);
  });

  it('renders shift backward (<) and forward (>) buttons', () => {
    renderViewer();
    const input = screen.getByRole('spinbutton', { name: /shift step/i });
    const buttons = within(containerOf(input)).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent('<');
    expect(buttons[1]).toHaveTextContent('>');
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

    expect(UplotReactMock).toHaveBeenCalledTimes(channelNames.length);
  });

  it('passes the correct channel name to each plot', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    UplotReactMock.mockClear();

    renderViewer();

    const calledOptions = UplotReactMock.mock.calls.map((call) => call[0].options.axes[1].label);
    expect(calledOptions).toEqual(channelNames);
  });

  it('only the last channel shows the x-axis', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    UplotReactMock.mockClear();

    renderViewer();

    const xAxisVisibility = UplotReactMock.mock.calls.map((call) => call[0].options.axes[0].show);
    expect(xAxisVisibility).toEqual([false, false, true]);
  });
});
