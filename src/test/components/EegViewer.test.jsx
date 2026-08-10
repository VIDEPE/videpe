import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EegViewer } from '@/components/EegViewer';

// capturedClickHandler stores the 'click' listener attached to u.over inside onCreate,
// so tests can fire a simulated click without a real uPlot instance.
let capturedClickHandler = null;

vi.mock('uplot-react', () => {
  const UplotReactMock = vi.fn(function ({ onCreate }) {
    if (onCreate) {
      // Simulate uPlot calling onCreate with a minimal fake instance
      const fakeUplot = {
        cursor: { left: 100 },
        posToVal: (_px, _scale) => 5.0,
        over: {
          addEventListener: (_event, handler) => {
            capturedClickHandler = handler;
          },
        },
      };
      onCreate(fakeUplot);
    }
    return null;
  });
  return { default: UplotReactMock };
});

// Isolate EegViewer tests from NiiVue's WebGL dependency — stub EegTopoViewer with a
// minimal element that exposes the data and close button tests need.
vi.mock('@/components/EegTopoViewer', () => ({
  EegTopoViewer: vi.fn(function ({
    onClose,
    totalChannels,
    matched,
    voltages,
    isIntracranial,
    customFileName,
  }) {
    return (
      <div data-testid="eeg-topo-viewer">
        <span>
          {matched.length} / {totalChannels} channels mapped
        </span>
        <span data-testid="topo-voltages">{voltages.join(',')}</span>
        <span data-testid="topo-is-intracranial">{String(isIntracranial)}</span>
        <span data-testid="topo-custom-filename">{customFileName ?? ''}</span>
        <button onClick={onClose}>Close topo</button>
      </div>
    );
  }),
}));

// Mutable via vi.hoisted so individual tests can flip themeState.isDarkMode (see the
// montage row color describe block below) — a plain top-level `let` wouldn't be
// initialized yet when this factory runs, since vi.mock is hoisted above imports.
const themeState = vi.hoisted(() => ({ isDarkMode: false }));
vi.mock('@/components/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: themeState.isDarkMode }),
}));

// EegViewer shows its own loading/success toast while the initial buffer loads, and a
// plain toast() call when the recording type is (re-)detected — stub it out so tests
// don't depend on react-hot-toast's internal store/portal. The real default export is
// itself a callable function with .loading/.success/.dismiss/etc. attached, so the mock
// must be too (a plain object here would make any toast(...) call throw silently inside
// the catch-wrapped promise chain that calls it).
vi.mock('react-hot-toast', () => {
  const toastFn = vi.fn();
  toastFn.loading = vi.fn();
  toastFn.success = vi.fn();
  toastFn.error = vi.fn();
  toastFn.dismiss = vi.fn();
  return { default: toastFn };
});

// Minimal .elc content whose labels match two of the three test channel names
const MOCK_ELC = `ReferenceLabel avg
UnitPosition mm
NumberPositions= 3
Positions
-29.0 84.0 -7.0
29.0 84.0 -7.0
0.0 0.0 88.0
Labels
EEG1
EEG2
Cz
`;

// jsdom does not implement ResizeObserver; use a class so `new` works,
// and fire the callback immediately so plotWidth/plotHeight become non-zero
beforeEach(() => {
  capturedClickHandler = null;
  themeState.isDarkMode = false;
  global.ResizeObserver = class {
    constructor(callback) {
      this._cb = callback;
    }
    observe() {
      this._cb([{ contentRect: { width: 800, height: 600 } }]);
    }
    disconnect() {}
  };
  global.fetch = vi.fn().mockResolvedValue({ text: () => Promise.resolve(MOCK_ELC) });
});

const INITIAL_Y_SCALE = 0.15; // must match the yScale useState default in EegViewer
const OVERDRAW = 2; // must match the OVERDRAW constant in EegViewer

const channelNames = ['EEG1', 'EEG2', 'EEG3'];

// Underlying "recording" the mock provider serves chunks from — 30 s recording so
// tMax(30) ≥ 20 → windowSize initialises to 20.
const TMAX = 30;
const TIMESTAMPS = [0, 10, 20, 30];
const CHANNEL_DATA = [
  [1, 2, 3, 4], // EEG1
  [4, 5, 6, 7], // EEG2
  [7, 8, 9, 10], // EEG3
];

// Minimal recording provider whose getChunk demultiplexes TIMESTAMPS/CHANNEL_DATA for
// the requested range — mirrors the { channelNames, fs, tMax, getChunk } shape returned
// by loadBrainVisionEEG.
const makeProvider = (tMax = TMAX) => ({
  channelNames,
  fs: 1,
  tMax,
  getChunk: vi.fn(async (start, end) => {
    const indices = TIMESTAMPS.map((_, i) => i).filter(
      (i) => TIMESTAMPS[i] >= start && TIMESTAMPS[i] <= end
    );
    return {
      timestamps: Float32Array.from(indices.map((i) => TIMESTAMPS[i])),
      channels: CHANNEL_DATA.map((values) => Float32Array.from(indices.map((i) => values[i]))),
    };
  }),
});

// Renders the viewer and flushes the initial (async) buffer load so timestamps/channels
// are populated before assertions run.
const renderViewer = async (provider = makeProvider()) => {
  const utils = render(<EegViewer provider={provider} channelNames={provider.channelNames} />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return utils;
};

// Helper: get the immediate flex-row container of an input
const containerOf = (input) => input.closest('div');

// Arms the topography toggle, then simulates a plot click — EegTopoViewer only opens once
// both are true (see the topoVisible derivation in EegViewer), so tests that need the window
// open must do the same two-step gesture a real user would.
const enableTopoAndClick = async () => {
  await userEvent.click(screen.getByRole('button', { name: /enable topograph map/i }));
  await act(async () => {
    capturedClickHandler?.();
  });
};

describe('EegViewer — controls presence', () => {
  it('renders the EEG topography toggle button', async () => {
    await renderViewer();
    const input = screen.getByRole('button', { name: /topograph map/i });
    expect(input).toBeInTheDocument();
  });

  it('renders the channel count input', async () => {
    await renderViewer();
    const input = screen.getByRole('spinbutton', { name: /number of channels/i });
    expect(input).toBeInTheDocument();
  });

  it('renders visible channels decrease (−) and increase (+) buttons', async () => {
    await renderViewer();
    const label2test = screen.getByText('Channels');
    expect(label2test).toBeInTheDocument();
    const buttons = within(containerOf(label2test)).getAllByRole('button');
    expect(buttons).toHaveLength(2);
  });

  it('renders visible channel count size input with default value of 20', async () => {
    await renderViewer();
    const input = screen.getByRole('spinbutton', { name: /window size/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(20);
  });

  it('renders the window size input with default value of 20', async () => {
    await renderViewer();
    const input = screen.getByRole('spinbutton', { name: /window size/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(20);
  });

  it('renders the Window Size label and its two buttons', async () => {
    await renderViewer();
    const label = screen.getByText('Window Size (s)');
    expect(label).toBeInTheDocument();
    const buttons = within(containerOf(label)).getAllByRole('button');
    expect(buttons).toHaveLength(2);
  });

  it('renders the shift step input with default value of 5', async () => {
    await renderViewer();
    const input = screen.getByRole('spinbutton', { name: /time step/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(5);
  });

  it('renders the Time Step label and its four buttons', async () => {
    await renderViewer();
    const label = screen.getByText('Time Step (s)');
    expect(label).toBeInTheDocument();
    const buttons = within(containerOf(label)).getAllByRole('button');
    expect(buttons).toHaveLength(4);
  });

  it('renders the Range label and its two buttons', async () => {
    await renderViewer();
    expect(screen.getByText('Range (µV)')).toBeInTheDocument();
    const rangeLabel = screen.getByText('Range (µV)');
    const buttons = within(containerOf(rangeLabel)).getAllByRole('button');
    expect(buttons).toHaveLength(2);
  });
});

describe('EegViewer — window size controls', () => {
  it('increases window size by 10 when + is clicked', async () => {
    const user = userEvent.setup();
    await renderViewer();
    const input = screen.getByRole('spinbutton', { name: /window size/i });
    const increaseBtn = within(containerOf(input)).getByRole('button', {
      name: 'Increase window size',
    });

    await user.click(increaseBtn);

    expect(input).toHaveValue(30);
  });

  it('decreases window size by 10 when − is clicked', async () => {
    const user = userEvent.setup();
    await renderViewer();
    const input = screen.getByRole('spinbutton', { name: /window size/i });
    const decreaseBtn = within(containerOf(input)).getByRole('button', {
      name: 'Decrease window size',
    });

    await user.click(decreaseBtn);

    expect(input).toHaveValue(10);
  });

  it('does not decrease window size below 1', async () => {
    const user = userEvent.setup();
    await renderViewer();
    const input = screen.getByRole('spinbutton', { name: /window size/i });
    const decreaseBtn = within(containerOf(input)).getByRole('button', {
      name: 'Decrease window size',
    });

    // Drive value to 1 via the input, then try to go lower
    fireEvent.change(input, { target: { value: '1' } });
    await user.click(decreaseBtn);

    expect(input).toHaveValue(1);
  });

  it('updates window size when a value is typed into the input', async () => {
    await renderViewer();
    const input = screen.getByRole('spinbutton', { name: /window size/i });

    fireEvent.change(input, { target: { value: '30' } });

    expect(input).toHaveValue(30);
  });

  it('rounds window size to 1 decimal place on blur', async () => {
    await renderViewer();
    const input = screen.getByRole('spinbutton', { name: /window size/i });

    // "5.75" is 4 chars (fits the tMax=30 window limit); 5.75 × 10 = 57.5 → Math.round = 58 → / 10 = 5.8
    fireEvent.change(input, { target: { value: '5.75' } });
    fireEvent.blur(input);

    expect(input).toHaveValue(5.8);
  });

  it('does not increase window size beyond tMax via the + button', async () => {
    const user = userEvent.setup();
    await renderViewer();
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
    await renderViewer();

    // Shift forward to startTime=10 using two > clicks (default step=5).
    // Window is then [10, 30] — right edge exactly touches tMax=30.
    const shiftInput = screen.getByRole('spinbutton', { name: /time step/i });
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

  it('clamps to tMax and rounds to 1 decimal on blur when value exceeds recording length', async () => {
    // tMax has more than one decimal place — the bug was that tMax was used verbatim
    // (e.g. "30.123456") instead of being rounded to 1 decimal ("30.1")
    await renderViewer(makeProvider(30.123456));
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
    await renderViewer();
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
    await renderViewer();
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
    await renderViewer();
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
    await renderViewer();
    const input = screen.getByRole('spinbutton', { name: /number of channels/i });
    const decreaseBtn = within(containerOf(input)).getByRole('button', {
      name: 'Show fewer channels',
    });

    fireEvent.change(input, { target: { value: '1' } });
    await user.click(decreaseBtn);

    expect(input).toHaveValue(1);
  });

  it('updates channel count when a value is typed into the input', async () => {
    await renderViewer();
    const input = screen.getByRole('spinbutton', { name: /number of channels/i });

    fireEvent.change(input, { target: { value: '2' } });

    expect(input).toHaveValue(2);
  });

  it('rounds visible channel count to nearest integer on blur', async () => {
    await renderViewer();
    const input = screen.getByRole('spinbutton', { name: /number of channels/i });

    // 2.5 → Math.round(2.5) = 3
    fireEvent.change(input, { target: { value: '2.5' } });
    fireEvent.blur(input);

    expect(input).toHaveValue(3);
  });
});

describe('EegViewer — start/end navigation', () => {
  const shiftControls = () => {
    const input = screen.getByRole('spinbutton', { name: /time step/i });
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
    await renderViewer();
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
    await renderViewer();
    const { jumpToEndBtn } = shiftControls();

    UplotReactMock.mockClear();
    await user.click(jumpToEndBtn); // >|

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    // range[1] = startTime + windowSize = (tMax - windowSize) + windowSize = tMax
    expect(range[1]).toBeCloseTo(TMAX, 5);
  });

  it('> shifts start time forward by the default shift step (5)', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    await renderViewer();
    const { forwardBtn } = shiftControls();

    UplotReactMock.mockClear();
    await user.click(forwardBtn); // >

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[0]).toBe(5);
  });

  it('< shifts start time backward by the default shift step', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    await renderViewer();
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
    await renderViewer();
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
    await renderViewer();

    const shiftInput = screen.getByRole('spinbutton', { name: /time step/i });
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
  it('updates shift step when a value is typed into the input', async () => {
    await renderViewer();
    const input = screen.getByRole('spinbutton', { name: /time step/i });

    fireEvent.change(input, { target: { value: '5' } });

    expect(input).toHaveValue(5);
  });

  it('does not allow shift step below 1', async () => {
    await renderViewer();
    const input = screen.getByRole('spinbutton', { name: /time step/i });

    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);

    expect(input).toHaveValue(1);
  });

  it('rounds shift step to 1 decimal place on blur', async () => {
    await renderViewer();
    const input = screen.getByRole('spinbutton', { name: /time step/i });

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

    await renderViewer();

    // +1 for the fixed x-axis strip. Rendered three times:
    // once while the initial buffer is loading, once after it resolves,
    // and once after the electrode position file loads and updates matched channels.
    expect(UplotReactMock).toHaveBeenCalledTimes(3 * (channelNames.length + 1));
  });

  it('renders a label overlay for each channel name', async () => {
    await renderViewer();

    for (const name of channelNames) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it('all channel plots suppress x-axis ticks/labels/border (labels are shown in the fixed strip instead)', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    UplotReactMock.mockClear();

    await renderViewer();

    // The first N calls are channel plots. Their x-axis is enabled (axes[0].show === true) only
    // so uPlot draws the vertical gridlines — every other visible part (ticks, border, reserved
    // size, labels) is suppressed. The fixed x-axis strip (the next call) shows the real ticks/labels.
    const channelCalls = UplotReactMock.mock.calls.slice(0, channelNames.length);
    for (const call of channelCalls) {
      const axis = call[0].options.axes[0];
      expect(axis.size).toBe(0);
      expect(axis.ticks.show).toBe(false);
      expect(axis.border.show).toBe(false);
      expect(axis.values()).toEqual([]);
    }
  });

  it('there is a vertical snapshot marker line rendered when clicking a plot', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    UplotReactMock.mockClear();

    await renderViewer();

    expect(screen.queryByTestId('snapshot-marker')).not.toBeInTheDocument();

    await act(async () => {
      capturedClickHandler?.();
    });

    expect(screen.getByTestId('snapshot-marker')).toBeInTheDocument();
  });

  it('all channels receive the same initial y-range', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    UplotReactMock.mockClear();

    await renderViewer();

    const channelCalls = UplotReactMock.mock.calls.slice(0, channelNames.length);
    const yRanges = channelCalls.map((call) => call[0].options.scales.y.range);
    yRanges.forEach((range) =>
      expect(range).toEqual([-INITIAL_Y_SCALE * OVERDRAW, INITIAL_Y_SCALE * OVERDRAW])
    );
  });
});

// ── EEG topography wiring ─────────────────────────────────────────────────────

describe('EegViewer — topography wiring', () => {
  it('fetches the electrode position file on mount', async () => {
    await renderViewer();
    expect(global.fetch).toHaveBeenCalledWith('electrode_positions/standard_1005.elc');
  });

  it('does not show EegTopoViewer on initial render', async () => {
    await renderViewer();
    expect(screen.queryByTestId('eeg-topo-viewer')).toBeNull();
  });

  it('toggles aria-pressed and label when clicked', async () => {
    await renderViewer();
    const button = screen.getByRole('button', { name: /enable topograph map/i });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /disable topograph map/i })).toBeInTheDocument();
  });

  it('clicking a channel plot opens EegTopoViewer', async () => {
    await renderViewer();
    await enableTopoAndClick();
    expect(screen.getByTestId('eeg-topo-viewer')).toBeTruthy();
  });

  it('closing EegTopoViewer hides it', async () => {
    await renderViewer();
    // Open
    await enableTopoAndClick();
    // Close
    await userEvent.click(screen.getByText('Close topo'));
    expect(screen.queryByTestId('eeg-topo-viewer')).toBeNull();
  });

  it('passes total channel count to EegTopoViewer', async () => {
    await renderViewer();
    await enableTopoAndClick();
    // MOCK_ELC has 2 labels matching the test channel names (EEG1, EEG2); total is 3
    expect(screen.getByText(/2\s*\/\s*3\s*channels mapped/i)).toBeTruthy();
  });
});

// ── ESI toggle wiring ──────────────────────────────────────────────────────────

describe('EegViewer — ESI toggle wiring', () => {
  it('is disabled with no inverse solution loaded', async () => {
    await renderViewer();
    const button = screen.getByRole('button', { name: /enable electrical source imaging/i });
    expect(button).toBeDisabled();
  });

  it('is enabled once an inverse solution is loaded, and toggles aria-pressed/label when clicked', async () => {
    const provider = makeProvider();
    const onEsiEnabledChange = vi.fn();
    render(
      <EegViewer
        provider={provider}
        channelNames={provider.channelNames}
        inverseSolutionFileName="my_inverse_solution"
        esiEnabled={false}
        onEsiEnabledChange={onEsiEnabledChange}
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const button = screen.getByRole('button', { name: /enable electrical source imaging/i });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(button);
    expect(onEsiEnabledChange).toHaveBeenCalledWith(true);
  });

  it('reflects esiEnabled=true via aria-pressed and label', async () => {
    const provider = makeProvider();
    render(
      <EegViewer
        provider={provider}
        channelNames={provider.channelNames}
        inverseSolutionFileName="my_inverse_solution"
        esiEnabled={true}
        onEsiEnabledChange={() => {}}
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const button = screen.getByRole('button', { name: /disable electrical source imaging/i });
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('stays disabled in iEEG mode even with an inverse solution loaded', async () => {
    const provider = makeIntracranialProvider();
    render(
      <EegViewer
        provider={provider}
        channelNames={provider.channelNames}
        recordingType="ieeg"
        inverseSolutionFileName="my_inverse_solution"
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const button = screen.getByRole('button', { name: /enable electrical source imaging/i });
    expect(button).toBeDisabled();
  });
});

describe('EegViewer — range controls', () => {
  it('zoom in button halves the plot y-range', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    await renderViewer();

    const zoomInBtn = within(containerOf(screen.getByText('Range (µV)'))).getByRole('button', {
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
    await renderViewer();

    const zoomOutBtn = within(containerOf(screen.getByText('Range (µV)'))).getByRole('button', {
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
    await renderViewer();

    // Set range to 0.003 so halving gives 0.0015, which rounds to 0.002 at 3dp
    fireEvent.change(screen.getByRole('spinbutton', { name: /range/i }), {
      target: { value: '0.003' },
    });

    const zoomInBtn = within(containerOf(screen.getByText('Range (µV)'))).getByRole('button', {
      name: 'Zoom in',
    });
    UplotReactMock.mockClear();
    await user.click(zoomInBtn);

    const [yMin, yMax] = UplotReactMock.mock.calls[0][0].options.scales.y.range;
    // 0.003 / 2 = 0.0015 → Math.round(0.0015 × 1000) / 1000 = 2/1000 = 0.002
    expect(yMin).toBe(-0.002 * OVERDRAW);
    expect(yMax).toBe(0.002 * OVERDRAW);
  });

  it('clamps range to Y_MIN (0.001) on blur when 0 is entered', async () => {
    await renderViewer();
    const input = screen.getByRole('spinbutton', { name: /range/i });

    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);

    expect(input).toHaveValue(0.001);
  });

  it('all channels share the same y-range after range change', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    await renderViewer();

    const zoomInBtn = within(containerOf(screen.getByText('Range (µV)'))).getByRole('button', {
      name: 'Zoom in',
    });
    UplotReactMock.mockClear();
    await user.click(zoomInBtn);

    const channelCalls = UplotReactMock.mock.calls.slice(0, channelNames.length);
    const yRanges = channelCalls.map((call) => call[0].options.scales.y.range);
    yRanges.forEach((range) => expect(range).toEqual(yRanges[0]));
  });

  it('does not increase range beyond 99999 via the ZoomOut button', async () => {
    const user = userEvent.setup();
    await renderViewer();
    const rangeInput = screen.getByRole('spinbutton', { name: /range/i });
    const zoomOutBtn = within(containerOf(screen.getByText('Range (µV)'))).getByRole('button', {
      name: 'Zoom out',
    });

    // Set range to 99999 (the 5-digit max), then click ZoomOut — which doubles to 199998 without a cap
    fireEvent.change(rangeInput, { target: { value: '99999' } });
    await user.click(zoomOutBtn);

    expect(rangeInput).toHaveValue(99999);
  });

  it('does not decrease range below Y_MIN (0.001) via the Zoom in button', async () => {
    const user = userEvent.setup();
    await renderViewer();
    const rangeInput = screen.getByRole('spinbutton', { name: /range/i });
    const zoomInBtn = within(containerOf(screen.getByText('Range (µV)'))).getByRole('button', {
      name: 'Zoom in',
    });

    // Set range to 0.001 (Y_MIN), then click Zoom in — which would halve to 0.0005 without a clamp
    fireEvent.change(rangeInput, { target: { value: '0.001' } });
    await user.click(zoomInBtn);

    expect(rangeInput).toHaveValue(0.001);
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

  it('renders the thumb at position 0 with width proportional to windowSize', async () => {
    await renderViewer();
    expect(thumb().style.left).toBe('0%');
    // windowSize=20, tMax=30 → 66.67%
    expect(parseFloat(thumb().style.width)).toBeCloseTo(66.67, 1);
  });

  it('never lets the thumb exceed 100% for a short, non-integer tMax (no horizontal overflow)', async () => {
    // Regression: defaultWindowSize used Math.ceil(tMax), so a non-integer tMax like
    // 6.01171875 (as the synthetic demo recording has) yielded windowSize=7 > tMax, making
    // the thumb wider than the track and overflowing the panel to the right.
    await renderViewer(makeProvider(6.01171875));
    expect(parseFloat(thumb().style.left)).toBe(0);
    // Full recording shown, but the thumb spans at most the whole track — never more.
    expect(parseFloat(thumb().style.width)).toBeLessThanOrEqual(100);
    expect(parseFloat(thumb().style.width)).toBeGreaterThan(99);
  });

  it('initialises the window size input to a clean 1-decimal value for a non-integer tMax', async () => {
    // Regression: the default was the raw tMax float (6.01171875…), overflowing the input's
    // char limit until a blur snapped it to 6. Floor-to-1-decimal makes it clean from the start.
    await renderViewer(makeProvider(6.01171875));
    const input = screen.getByRole('spinbutton', { name: /window size/i });
    expect(input).toHaveValue(6);
  });

  it('clicking the bar jumps start time to the clicked position', async () => {
    await renderViewer();
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

  it('dragging the thumb moves the window forward', async () => {
    await renderViewer();
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

  it('dragging the thumb clamps start time at 0', async () => {
    await renderViewer();
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

  it('dragging the right handle increases window size', async () => {
    await renderViewer();
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

  it('dragging the left handle shrinks the window from the left', async () => {
    await renderViewer();
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

  it('dragging the right handle updates the window size input', async () => {
    await renderViewer();
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

  it('dragging the left handle updates the window size input', async () => {
    await renderViewer();
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

  it('dragging the thumb clamps start time at tMax − windowSize', async () => {
    await renderViewer();
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

  it('dragging the right handle clamps windowSize at tMax', async () => {
    await renderViewer();
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

  it('dragging the left handle clamps windowSize to a minimum of 1', async () => {
    await renderViewer();
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

  it('mouseup stops the drag — further moves have no effect', async () => {
    await renderViewer();
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
  it('shift step input has max attribute equal to the current window size', async () => {
    await renderViewer();
    const input = screen.getByRole('spinbutton', { name: /time step/i });
    // default windowSize = 20
    expect(input).toHaveAttribute('max', '20');
  });

  it('shift step clamps to window size on blur when the typed value exceeds it', async () => {
    await renderViewer();
    const input = screen.getByRole('spinbutton', { name: /time step/i });

    fireEvent.change(input, { target: { value: '25' } }); // 25 > windowSize=20
    fireEvent.blur(input);

    expect(input).toHaveValue(20);
  });

  it('decreasing window size clamps an oversized shift step down to the new window size', async () => {
    const user = userEvent.setup();
    await renderViewer();
    const shiftInput = screen.getByRole('spinbutton', { name: /time step/i });
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
    await renderViewer();
    const shiftInput = screen.getByRole('spinbutton', { name: /time step/i });
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

  it('renders a keyboard shortcuts hint with a tooltip', async () => {
    await renderViewer();
    expect(screen.getByRole('tooltip')).toHaveTextContent(/keyboard navigation/i);
  });

  it('clicking the viewer background focuses it', async () => {
    await renderViewer();
    fireEvent.mouseDown(viewer());
    expect(viewer()).toHaveFocus();
  });

  it('clicking a button does not move focus to the viewer container', async () => {
    const user = userEvent.setup();
    await renderViewer();
    const zoomInBtn = within(containerOf(screen.getByText('Range (µV)'))).getByRole('button', {
      name: 'Zoom in',
    });

    await user.click(zoomInBtn);

    expect(viewer()).not.toHaveFocus();
  });

  it('ArrowUp halves the range (zoom in)', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    await renderViewer();

    UplotReactMock.mockClear();
    fireEvent.keyDown(viewer(), { key: 'ArrowUp' });

    const [yMin, yMax] = UplotReactMock.mock.calls[0][0].options.scales.y.range;
    expect(yMin).toBeCloseTo((-INITIAL_Y_SCALE / 2) * OVERDRAW, 3);
    expect(yMax).toBeCloseTo((INITIAL_Y_SCALE / 2) * OVERDRAW, 3);
  });

  it('ArrowDown doubles the range (zoom out)', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    await renderViewer();

    UplotReactMock.mockClear();
    fireEvent.keyDown(viewer(), { key: 'ArrowDown' });

    const [yMin, yMax] = UplotReactMock.mock.calls[0][0].options.scales.y.range;
    expect(yMin).toBeCloseTo(-INITIAL_Y_SCALE * 2 * OVERDRAW, 3);
    expect(yMax).toBeCloseTo(INITIAL_Y_SCALE * 2 * OVERDRAW, 3);
  });

  it('ArrowRight pans forward by the shift step', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    await renderViewer();

    UplotReactMock.mockClear();
    fireEvent.keyDown(viewer(), { key: 'ArrowRight' });

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[0]).toBe(5);
  });

  it('ArrowLeft pans backward by the shift step', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    await renderViewer();

    fireEvent.keyDown(viewer(), { key: 'ArrowRight' }); // startTime 0 → 5
    UplotReactMock.mockClear();
    fireEvent.keyDown(viewer(), { key: 'ArrowLeft' }); // startTime 5 → 0

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[0]).toBe(0);
  });

  it('PageDown jumps forward by one window, clamped to tMax − windowSize', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    await renderViewer();

    UplotReactMock.mockClear();
    fireEvent.keyDown(viewer(), { key: 'PageDown' });

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[0]).toBe(10); // min(tMax-windowSize, 0+windowSize) = min(10, 20) = 10
    expect(range[1]).toBe(30);
  });

  it('PageUp jumps backward by one window, clamped at 0', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    await renderViewer();

    fireEvent.keyDown(viewer(), { key: 'PageDown' }); // startTime 0 → 10
    UplotReactMock.mockClear();
    fireEvent.keyDown(viewer(), { key: 'PageUp' }); // startTime 10 → 0

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[0]).toBe(0);
  });

  it('Home jumps to the beginning of the recording', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    await renderViewer();

    fireEvent.keyDown(viewer(), { key: 'ArrowRight' }); // startTime 0 → 5
    UplotReactMock.mockClear();
    fireEvent.keyDown(viewer(), { key: 'Home' });

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[0]).toBe(0);
  });

  it('End jumps to the end of the recording', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    await renderViewer();

    UplotReactMock.mockClear();
    fireEvent.keyDown(viewer(), { key: 'End' });

    const range = UplotReactMock.mock.calls[0][0].options.scales.x.range;
    expect(range[1]).toBeCloseTo(TMAX, 5);
  });

  it('does not respond to keyboard shortcuts while an input is focused', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    await renderViewer();
    const rangeInput = screen.getByRole('spinbutton', { name: /range/i });

    UplotReactMock.mockClear();
    fireEvent.keyDown(rangeInput, { key: 'ArrowUp' });

    expect(UplotReactMock).not.toHaveBeenCalled();
  });
});

describe('EegViewer — time shift clamping', () => {
  // tMax=30, windowSize=20 → valid startTime range is [0, 10]
  const shiftControls = () => {
    const input = screen.getByRole('spinbutton', { name: /time step/i });
    const scope = within(input.closest('div'));
    return {
      backwardBtn: scope.getByRole('button', { name: 'Shift backward' }),
      forwardBtn: scope.getByRole('button', { name: 'Shift forward' }),
    };
  };

  it('forward shift clamps at tMax − windowSize', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const user = userEvent.setup();
    await renderViewer();

    // Set a step large enough to overshoot in one click (25 > tMax−windowSize=10)
    fireEvent.change(screen.getByRole('spinbutton', { name: /time step/i }), {
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
    await renderViewer();
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
    await renderViewer();
    const { backwardBtn, forwardBtn } = shiftControls();

    // Set a step large enough to undershoot in one click from any position
    fireEvent.change(screen.getByRole('spinbutton', { name: /time step/i }), {
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

describe('EegViewer — onViewReady callback', () => {
  it('calls onViewReady once the first measurement lands', async () => {
    const onViewReady = vi.fn();
    const provider = makeProvider();
    render(
      <EegViewer
        provider={provider}
        channelNames={provider.channelNames}
        onViewReady={onViewReady}
      />
    );

    // ResizeObserver fires synchronously in the mock, so plotWidth > 0 right away —
    // onViewReady fires immediately, independent of the (async) buffer load.
    expect(onViewReady).toHaveBeenCalledTimes(1);

    // Mounting also kicks off some background work (loading electrode positions, loading
    // the EEG buffer) that only finishes after the check above. Wait for it here so it
    // doesn't spill over into whichever test runs next.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  });
});

describe('EegViewer — loading toast', () => {
  beforeEach(async () => {
    const { default: toast } = await import('react-hot-toast');
    toast.loading.mockClear();
    toast.success.mockClear();
    toast.dismiss.mockClear();
  });

  it('shows a loading toast while the initial buffer loads, then a success toast', async () => {
    const { default: toast } = await import('react-hot-toast');
    const provider = makeProvider();
    render(<EegViewer provider={provider} channelNames={provider.channelNames} />);

    // Initial buffer hasn't resolved yet — loading toast shown, success toast not yet.
    expect(toast.loading).toHaveBeenCalledWith('Loading EEG data…', { id: expect.any(String) });
    expect(toast.success).not.toHaveBeenCalled();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Buffer has loaded — the same toast id is updated to a success message.
    const loadingId = toast.loading.mock.calls[0][1].id;
    expect(toast.success).toHaveBeenCalledWith('EEG data loaded!', { id: loadingId });
  });

  it('dismisses the loading toast on unmount', async () => {
    const { default: toast } = await import('react-hot-toast');
    const provider = makeProvider();
    const { unmount } = render(
      <EegViewer provider={provider} channelNames={provider.channelNames} />
    );

    const loadingId = toast.loading.mock.calls[0][1].id;
    unmount();

    expect(toast.dismiss).toHaveBeenCalledWith(loadingId);
  });
});

// ── Montage / re-referencing ──────────────────────────────────────────────────
// CHANNEL_DATA per sample: EEG1=[1,2,3,4], EEG2=[4,5,6,7], EEG3=[7,8,9,10].
// Cross-channel mean per sample is [4,5,6,7], so e.g. average-referenced
// EEG1 = [1-4, 2-5, 3-6, 4-7] = [-3,-3,-3,-3].

describe('EegViewer — montage controls', () => {
  it('renders a Montage button and a dropdown defaulting to none', async () => {
    await renderViewer();
    expect(screen.getByRole('button', { name: 'Montage' })).toBeInTheDocument();
    const select = screen.getByLabelText(/montage/i);
    expect(select.value).toBe('none');
  });

  it('montage dropdown has None, Average, and Median options', async () => {
    await renderViewer();
    const select = screen.getByLabelText(/montage/i);
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain('none');
    expect(values).toContain('average');
    expect(values).toContain('median');
  });

  it('reports the selected montage via onMontageChange instead of applying it itself', async () => {
    const onMontageChange = vi.fn();
    const user = userEvent.setup();
    const provider = makeProvider();
    render(
      <EegViewer
        provider={provider}
        channelNames={provider.channelNames}
        montage="none"
        onMontageChange={onMontageChange}
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await user.selectOptions(screen.getByLabelText(/montage/i), 'average');
    expect(onMontageChange).toHaveBeenCalledWith('average');
  });

  // montage is a controlled prop (PatientView owns the state so it can force 'average'
  // when ESI needs it and react when the user switches away) — tests simulate the parent
  // feeding the updated value back down via rerender, same pattern as recordingType below.
  it('does not re-reference the channel plot data when the montage prop changes (the global montage select now only drives topography/connectome/ESI — the waveform re-references per row via the montage editor instead)', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const provider = makeProvider();
    const { rerender } = render(
      <EegViewer provider={provider} channelNames={provider.channelNames} montage="none" />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    UplotReactMock.mockClear();
    rerender(
      <EegViewer provider={provider} channelNames={provider.channelNames} montage="average" />
    );

    // EEG1 raw values for the visible window are [1,2,3] — unchanged, since with no montage
    // rows configured every row falls back to its raw channel (referenceMode: null).
    const eeg1Data = Array.from(UplotReactMock.mock.calls[0][0].data[1]);
    expect(eeg1Data).toEqual([1, 2, 3]);
  });
});

describe('eeg plot resize handle', () => {
  const setup = async () => {
    await renderViewer();
    const row = screen.getByTestId('eeg-plot-row');
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ height: 400 });
    return row;
  };

  it('renders a resize handle', async () => {
    await setup();
    expect(screen.getByTestId('eeg-plot-resize-handle')).toBeInTheDocument();
  });

  // The drag/clamp math itself (raise/lower, floor clamping, stopping after mouseup) is
  // unit-tested directly in useRowResize.test.jsx. This smoke test only confirms
  // EegViewer actually wires a real drag on its own resize handle through to the row's
  // min-height, with its own MIN_PLOT_ROW_HEIGHT floor.
  it('wires drags on its own resize handle through to the plot row min-height', async () => {
    const row = await setup();
    fireEvent.mouseDown(screen.getByTestId('eeg-plot-resize-handle'), { clientY: 0 });
    fireEvent.mouseMove(window, { clientY: 150 });
    fireEvent.mouseUp(window);

    expect(row.style.minHeight).toBe('550px'); // 400 (starting height) + 150 (drag delta)
  });
});

describe('EegViewer — topography uses the montaged buffer', () => {
  it('topography voltages reflect the montage prop', async () => {
    const provider = makeProvider();
    const { rerender } = render(
      <EegViewer provider={provider} channelNames={provider.channelNames} montage="none" />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Open the topography viewer at the mocked click timepoint
    await enableTopoAndClick();
    // matched channels are EEG1 (idx0) and EEG2 (idx1); raw values at the clicked
    // sample are EEG1=4, EEG2=7
    expect(screen.getByTestId('topo-voltages').textContent).toBe('4,7');

    rerender(
      <EegViewer provider={provider} channelNames={provider.channelNames} montage="average" />
    );

    // cross-channel mean at that sample = (4+7+10)/3 = 7 → EEG1: 4-7=-3, EEG2: 7-7=0
    expect(screen.getByTestId('topo-voltages').textContent).toBe('-3,0');
  });
});

// ── Recording type detection (EEG vs iEEG) ───────────────────────────────────
// channelNames = ['EEG1','EEG2','EEG3'] against MOCK_ELC (labels EEG1, EEG2, Cz):
// electrodeContactShapeRatio = 3/3 = 1.0, but standard1005MatchRatio = 2/3 ≈ 0.67
// (not < 0.3), so this fixture is detected as scalp EEG, not intracranial.

const INTRACRANIAL_CHANNEL_NAMES = ['B1', 'B2', "B'1"]; // primed group — always detected as iEEG

const makeIntracranialProvider = () => ({
  channelNames: INTRACRANIAL_CHANNEL_NAMES,
  fs: 1,
  tMax: TMAX,
  getChunk: vi.fn(async (start, end) => {
    const indices = TIMESTAMPS.map((_, i) => i).filter(
      (i) => TIMESTAMPS[i] >= start && TIMESTAMPS[i] <= end
    );
    return {
      timestamps: Float32Array.from(indices.map((i) => TIMESTAMPS[i])),
      channels: CHANNEL_DATA.map((values) => Float32Array.from(indices.map((i) => values[i]))),
    };
  }),
});

describe('EegViewer — recording type detection', () => {
  // recordingType is now a controlled prop (PatientView owns the state and shows/drives the
  // EEG/iEEG toggle in the SplitPane title) — EegViewer only reports detection results upward
  // via onRecordingTypeChange and reads the effective value back down via the recordingType
  // prop. These tests exercise both halves of that contract directly, instead of a UI toggle
  // that no longer lives in this component.
  beforeEach(async () => {
    const { default: toast } = await import('react-hot-toast');
    toast.mockClear();
  });

  // Detection logic itself (onRecordingTypeChange + toast for both scalp and intracranial
  // channel shapes) is unit-tested directly in useElectrodeMatching.test.js. The tests below
  // only cover what that hook test can't: how EegViewer wires the resulting isIntracranial
  // state into its children (EegTopoViewer).

  it('disables the topo toggle for an intracranial recordingType with no known electrode positions at all', async () => {
    const provider = makeIntracranialProvider();
    render(
      <EegViewer provider={provider} channelNames={provider.channelNames} recordingType="ieeg" />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Nothing can ever be mapped without positions — the toggle must stay disabled rather
    // than let the user open a permanently-empty topo window.
    expect(screen.getByRole('button', { name: /topograph map/i })).toBeDisabled();
  });

  it('keeps matched empty for an intracranial recordingType whose custom positions do not match any channel, even though standard_1005 was fetched', async () => {
    const provider = makeIntracranialProvider();
    // A position file is loaded (so the topo toggle is enabled), but none of its labels
    // match this recording's channel names — mirrors loading the wrong patient's/montage's
    // position file, as opposed to no file at all (which is covered by the "disables the
    // topo toggle" test above and can no longer reach this code path via the UI).
    const customElectrodes = [{ label: 'X1', x: 0, y: 0, z: 0 }];
    // recordingType is normally fed back down as a prop by the parent in response to the
    // onRecordingTypeChange callback above (see PatientView) — passed directly here to
    // exercise the same isIntracranial-driven behavior without reimplementing that parent.
    render(
      <EegViewer
        provider={provider}
        channelNames={provider.channelNames}
        recordingType="ieeg"
        customElectrodes={customElectrodes}
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await enableTopoAndClick();

    expect(global.fetch).toHaveBeenCalled(); // still fetched, just not used for rendering in this mode
    expect(screen.getByText(/0\s*\/\s*3\s*channels mapped/i)).toBeTruthy();
    expect(screen.getByTestId('topo-is-intracranial')).toHaveTextContent('true');
  });

  it('switches intracranial-mode behavior when the recordingType prop changes (simulating a manual override)', async () => {
    const provider = makeProvider(); // scalp-shaped fixture
    const { rerender } = render(
      <EegViewer provider={provider} channelNames={provider.channelNames} recordingType="eeg" />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await enableTopoAndClick();
    expect(screen.getByTestId('topo-is-intracranial')).toHaveTextContent('false');

    rerender(
      <EegViewer provider={provider} channelNames={provider.channelNames} recordingType="ieeg" />
    );
    expect(screen.getByTestId('topo-is-intracranial')).toHaveTextContent('true');
  });
});

describe('EegViewer — lifted electrode state callback', () => {
  it('calls onElectrodeSnapshotChange with the current mode, matched channels, and voltages', async () => {
    const onElectrodeSnapshotChange = vi.fn();
    const provider = makeProvider();
    render(
      <EegViewer
        provider={provider}
        channelNames={provider.channelNames}
        onElectrodeSnapshotChange={onElectrodeSnapshotChange}
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onElectrodeSnapshotChange).toHaveBeenCalledWith(
      expect.objectContaining({ isIntracranial: false, voltages: [] })
    );

    onElectrodeSnapshotChange.mockClear();
    await act(async () => {
      capturedClickHandler?.();
    });

    expect(onElectrodeSnapshotChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ isIntracranial: false, voltages: [4, 7] })
    );
  });
});

describe('EegViewer — customElectrodes prop', () => {
  const CUSTOM_ELECTRODES = [{ label: 'EEG3', x: 1, y: 1, z: 1 }];

  it('uses customElectrodes instead of the standard template when provided', async () => {
    const provider = makeProvider();
    render(
      <EegViewer
        provider={provider}
        channelNames={provider.channelNames}
        customElectrodes={CUSTOM_ELECTRODES}
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await enableTopoAndClick();

    // Only EEG3 matches the custom template, vs EEG1+EEG2 in the standard one.
    expect(screen.getByText(/1\s*\/\s*3\s*channels mapped/i)).toBeTruthy();
  });

  it('forwards customElecPosFileName to EegTopoViewer as customFileName', async () => {
    const provider = makeProvider();
    render(
      <EegViewer
        provider={provider}
        channelNames={provider.channelNames}
        customElectrodes={CUSTOM_ELECTRODES}
        customElecPosFileName="my_positions"
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await enableTopoAndClick();

    expect(screen.getByTestId('topo-custom-filename')).toHaveTextContent('my_positions');
  });
});

describe('EegViewer — persistent electrode position dropzone', () => {
  it('renders a dropzone for electrode positions and inverse solution even while the topography window is closed', async () => {
    await renderViewer();
    expect(screen.queryByTestId('eeg-topo-viewer')).toBeNull();
    expect(
      screen.getByText('Browse or drop electrode positions / inverse solution')
    ).toBeInTheDocument();
  });

  it('calls onElecPosFile with the dropped .elc file', async () => {
    const onElecPosFile = vi.fn();
    const provider = makeProvider();
    render(
      <EegViewer
        provider={provider}
        channelNames={provider.channelNames}
        onElecPosFile={onElecPosFile}
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const file = new File(['# ASA electrode file'], 'custom.elc');
    const input = document.querySelector('input[type="file"]');
    await userEvent.upload(input, file);

    expect(onElecPosFile).toHaveBeenCalledWith(file);
  });

  it('calls onInverseSolutionFile with a dropped .mat file', async () => {
    const onInverseSolutionFile = vi.fn();
    const provider = makeProvider();
    render(
      <EegViewer
        provider={provider}
        channelNames={provider.channelNames}
        onInverseSolutionFile={onInverseSolutionFile}
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const file = new File(['binary'], 'sub-19_inversefilters.mat');
    const input = document.querySelector('input[type="file"]');
    await userEvent.upload(input, file);

    expect(onInverseSolutionFile).toHaveBeenCalledWith(file);
  });

  // StatusLed's own props→color/title mapping is unit-tested directly in
  // StatusLed.test.jsx. These tests are a different axis: do they verify EegViewer computes
  // the right matchCount/totalCount/isGoodMatch for a given channel/template scenario —
  // color is kept as the observable proof that the MIN_STANDARD_MATCH_COUNT_FOR_LED
  // threshold was actually crossed (or not), not just that a number was rendered.
  it('shows the electrode position LED with the standard_1005 match count, colored red, when the match is below the minimum threshold', async () => {
    await renderViewer();

    expect(screen.getByText('Electrode Position')).toBeInTheDocument();
    // MOCK_ELC matches 2 of the 3 test channel names — well under the 19 required for a
    // usable topography, so the count is shown but the LED reads red, not blue.
    const led = screen.getByTitle('Using standard_1005 template (2/3 channels matched)');
    expect(led).toBeInTheDocument();
    expect(led.querySelector('span')).toHaveClass('bg-red-600/50');
    expect(screen.getByText('Inverse Solution')).toBeInTheDocument();
    expect(screen.getByTitle('No inverse solution loaded')).toBeInTheDocument();
  });

  it('shows the electrode position LED with a 0-match count, colored red, when the standard template matches no channels', async () => {
    global.fetch = vi.fn().mockResolvedValue({ text: () => Promise.resolve(MOCK_ELC) });
    const provider = makeProvider();
    provider.channelNames = ['NoMatch1', 'NoMatch2'];
    render(<EegViewer provider={provider} channelNames={provider.channelNames} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const led = screen.getByTitle('Using standard_1005 template (0/2 channels matched)');
    expect(led).toBeInTheDocument();
    expect(led.querySelector('span')).toHaveClass('bg-red-600/50');
  });

  // Real high-density recordings (e.g. the demo dataset) can share only a handful of
  // labels (like "Cz") with the standard_1005 template out of 200+ channels — a
  // technically non-empty match too sparse to be a usable topography.
  it('shows the electrode position LED as not auto-matched (red) when only a small minority of channels match the standard template', async () => {
    global.fetch = vi.fn().mockResolvedValue({ text: () => Promise.resolve(MOCK_ELC) });
    const provider = makeProvider();
    provider.channelNames = ['Cz', 'X1', 'X2']; // MOCK_ELC only matches "Cz" — 1/3, and 1 < 19
    render(<EegViewer provider={provider} channelNames={provider.channelNames} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const led = screen.getByTitle('Using standard_1005 template (1/3 channels matched)');
    expect(led).toBeInTheDocument();
    expect(led.querySelector('span')).toHaveClass('bg-red-600/50');
  });

  it('shows the electrode position LED as auto-matched (blue) when the standard template match meets the minimum threshold', async () => {
    const manyChannelNames = Array.from({ length: 19 }, (_, i) => `E${i + 1}`);
    const manyMatchElc = [
      'ReferenceLabel avg',
      'UnitPosition mm',
      `NumberPositions= ${manyChannelNames.length}`,
      'Positions',
      ...manyChannelNames.map(() => '0.0 0.0 0.0'),
      'Labels',
      ...manyChannelNames,
      '',
    ].join('\n');
    global.fetch = vi.fn().mockResolvedValue({ text: () => Promise.resolve(manyMatchElc) });
    const provider = {
      channelNames: manyChannelNames,
      fs: 1,
      tMax: TMAX,
      getChunk: vi.fn(async (start, end) => {
        const indices = TIMESTAMPS.map((_, i) => i).filter(
          (i) => TIMESTAMPS[i] >= start && TIMESTAMPS[i] <= end
        );
        return {
          timestamps: Float32Array.from(indices.map((i) => TIMESTAMPS[i])),
          channels: manyChannelNames.map(() => Float32Array.from(indices.map(() => 0))),
        };
      }),
    };
    render(<EegViewer provider={provider} channelNames={provider.channelNames} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const led = screen.getByTitle('Using standard_1005 template (19/19 channels matched)');
    expect(led).toBeInTheDocument();
    expect(led.querySelector('span')).toHaveClass('bg-blue-500');
  });

  it('shows the electrode position filename in the status LED once customElecPosFileName is provided', async () => {
    const provider = makeProvider();
    render(
      <EegViewer
        provider={provider}
        channelNames={provider.channelNames}
        customElecPosFileName="my_positions"
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // customElectrodes isn't passed here, so the match count is 0/3 — this test only
    // verifies the filename surfaces in the title, not match quality (see the dedicated
    // amber/green match-quality tests below).
    expect(screen.getByTitle('Custom: my_positions (0/3 channels matched)')).toBeInTheDocument();
    expect(screen.getByTitle('No inverse solution loaded')).toBeInTheDocument();
  });

  it('shows the electrode position LED as green when a custom file matches at least 90% of channels', async () => {
    const provider = makeProvider();
    render(
      <EegViewer
        provider={provider}
        channelNames={provider.channelNames}
        customElecPosFileName="my_positions"
        customElectrodes={[
          { label: 'EEG1', x: 0, y: 0, z: 0 },
          { label: 'EEG2', x: 1, y: 1, z: 1 },
          { label: 'EEG3', x: 2, y: 2, z: 2 },
        ]}
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const led = screen.getByTitle('Custom: my_positions (3/3 channels matched)');
    expect(led).toBeInTheDocument();
    expect(led.querySelector('span')).toHaveClass('bg-green-500');
  });

  it('shows the electrode position LED as amber when a custom file matches fewer than 90% of channels — likely the wrong file', async () => {
    const provider = makeProvider();
    render(
      <EegViewer
        provider={provider}
        channelNames={provider.channelNames}
        customElecPosFileName="my_positions"
        customElectrodes={[{ label: 'EEG1', x: 0, y: 0, z: 0 }]}
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const led = screen.getByTitle('Custom: my_positions (1/3 channels matched)');
    expect(led).toBeInTheDocument();
    expect(led.querySelector('span')).toHaveClass('bg-amber-500');
  });

  it('shows the electrode position LED match count for a custom file even in iEEG mode, where the standard template never applies', async () => {
    const provider = makeIntracranialProvider();
    render(
      <EegViewer
        provider={provider}
        channelNames={provider.channelNames}
        recordingType="ieeg"
        customElecPosFileName="my_positions"
        customElectrodes={[
          { label: 'B1', x: 0, y: 0, z: 0 },
          { label: 'B2', x: 1, y: 1, z: 1 },
        ]}
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // 2/3 intracranial channels matched — below the 90% custom-match bar, so amber.
    const led = screen.getByTitle('Custom: my_positions (2/3 channels matched)');
    expect(led).toBeInTheDocument();
    expect(led.querySelector('span')).toHaveClass('bg-amber-500');
  });

  it('shows the inverse solution filename in the status LED once inverseSolutionFileName is provided', async () => {
    const provider = makeProvider();
    render(
      <EegViewer
        provider={provider}
        channelNames={provider.channelNames}
        inverseSolutionFileName="my_inverse_solution"
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Inverse Solution has no match-count concept — loaded must mean green, not amber.
    const led = screen.getByTitle('my_inverse_solution');
    expect(led).toBeInTheDocument();
    expect(led.querySelector('span')).toHaveClass('bg-green-500');
    expect(
      screen.getByTitle('Using standard_1005 template (2/3 channels matched)')
    ).toBeInTheDocument();
  });

  it('greys out the inverse solution LED in iEEG mode, even with a file loaded', async () => {
    const provider = makeIntracranialProvider();
    render(
      <EegViewer
        provider={provider}
        channelNames={provider.channelNames}
        recordingType="ieeg"
        inverseSolutionFileName="my_inverse_solution"
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      screen.getByTitle('Inverse Solution is not applicable for iEEG recordings')
    ).toBeInTheDocument();
    // Electrode position stays fully active/relevant in iEEG mode.
    expect(screen.queryByTitle(/electrode position is not applicable/i)).not.toBeInTheDocument();
  });

  it('routes .elc and .mat to their respective handlers when dropped together', async () => {
    const onElecPosFile = vi.fn();
    const onInverseSolutionFile = vi.fn();
    const provider = makeProvider();
    render(
      <EegViewer
        provider={provider}
        channelNames={provider.channelNames}
        onElecPosFile={onElecPosFile}
        onInverseSolutionFile={onInverseSolutionFile}
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const elcFile = new File(['# ASA electrode file'], 'positions.elc');
    const matFile = new File(['binary'], 'sub-19_inversefilters.mat');
    const input = document.querySelector('input[type="file"]');
    await userEvent.upload(input, [elcFile, matFile]);

    expect(onElecPosFile).toHaveBeenCalledWith(elcFile);
    expect(onInverseSolutionFile).toHaveBeenCalledWith(matFile);
  });

  it('rejects an imaging file with an error toast instead of silently dropping it', async () => {
    const { default: toast } = await import('react-hot-toast');
    toast.error.mockClear();
    const onElecPosFile = vi.fn();
    const onInverseSolutionFile = vi.fn();
    const provider = makeProvider();
    render(
      <EegViewer
        provider={provider}
        channelNames={provider.channelNames}
        onElecPosFile={onElecPosFile}
        onInverseSolutionFile={onInverseSolutionFile}
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // fireEvent.drop (not userEvent.upload) — drag-and-drop bypasses the input's `accept`
    // filter the way a real OS drag does, so this exercises the actual rejection logic
    // rather than the browser's own file-picker filtering.
    const niiFile = new File(['binary'], 'sub-01_T1w.nii');
    const zone = screen
      .getByText('Browse or drop electrode positions / inverse solution')
      .closest('div[class]');
    fireEvent.drop(zone, { dataTransfer: { files: [niiFile] } });

    expect(onElecPosFile).not.toHaveBeenCalled();
    expect(onInverseSolutionFile).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('sub-01_T1w.nii'));
  });
});

// hoveredLedHighlight only ever tracks one of 'electrodePosition' | 'inverseSolution' | null —
// these tests drive it through the toggle wrapper divs' onMouseEnter/onMouseLeave (rather than
// asserting the state variable directly, which isn't exposed) and observe it through the LED's
// dot class, the same way a user would perceive it.
describe('EegViewer — hovering a disabled toggle highlights the LED that explains why', () => {
  it('highlights the Electrode Position LED red while hovering the disabled topo toggle, and reverts on unhover', async () => {
    const provider = makeIntracranialProvider();
    render(
      <EegViewer provider={provider} channelNames={provider.channelNames} recordingType="ieeg" />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const topoButton = screen.getByRole('button', { name: /topograph map/i });
    expect(topoButton).toBeDisabled();
    const led = screen.getByTitle('No electrode position loaded').querySelector('span');
    expect(led).toHaveClass('bg-red-600/50');

    // The handler lives on the toggle's wrapper div, not the (disabled) button itself.
    await userEvent.hover(topoButton.parentElement);
    expect(led).toHaveClass('bg-red-600');
    expect(led).not.toHaveClass('bg-red-600/50');

    await userEvent.unhover(topoButton.parentElement);
    expect(led).toHaveClass('bg-red-600/50');
  });

  it('highlights the Electrode Position LED red while hovering the disabled 3D-render toggle', async () => {
    const provider = makeIntracranialProvider();
    render(
      <EegViewer provider={provider} channelNames={provider.channelNames} recordingType="ieeg" />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const renderButton = screen.getByRole('button', { name: /3d electrode rendering/i });
    expect(renderButton).toBeDisabled();
    const led = screen.getByTitle('No electrode position loaded').querySelector('span');

    await userEvent.hover(renderButton.parentElement);
    expect(led).toHaveClass('bg-red-600');

    await userEvent.unhover(renderButton.parentElement);
    expect(led).toHaveClass('bg-red-600/50');
  });

  it('highlights the Inverse Solution LED red while hovering the disabled ESI toggle, leaving the Electrode Position LED untouched', async () => {
    await renderViewer();

    const esiButton = screen.getByRole('button', { name: /electrical source imaging/i });
    expect(esiButton).toBeDisabled();
    const inverseLed = screen.getByTitle('No inverse solution loaded').querySelector('span');
    // Default renderViewer() scenario: standard_1005 matches 2/3 channels — below threshold,
    // so this LED is already red on its own merits, unrelated to any hover.
    const electrodeLed = screen
      .getByTitle('Using standard_1005 template (2/3 channels matched)')
      .querySelector('span');

    await userEvent.hover(esiButton.parentElement);
    expect(inverseLed).toHaveClass('bg-red-600');
    expect(inverseLed).not.toHaveClass('bg-red-600/50');
    // Only the LED matching the hovered toggle's reason lights up — a highlight isn't
    // broadcast to every red LED on screen.
    expect(electrodeLed).toHaveClass('bg-red-600/50');
    expect(electrodeLed).not.toHaveClass('bg-red-600');

    await userEvent.unhover(esiButton.parentElement);
    expect(inverseLed).toHaveClass('bg-red-600/50');
  });

  it('does not highlight the Inverse Solution LED for the iEEG-disabled ESI toggle, since that LED is already greyed out for a different reason', async () => {
    const provider = makeIntracranialProvider();
    render(
      <EegViewer
        provider={provider}
        channelNames={provider.channelNames}
        recordingType="ieeg"
        inverseSolutionFileName="my_inverse_solution"
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const esiButton = screen.getByRole('button', { name: /electrical source imaging/i });
    expect(esiButton).toBeDisabled();
    const led = screen
      .getByTitle('Inverse Solution is not applicable for iEEG recordings')
      .querySelector('span');
    expect(led).toHaveClass('bg-foreground/20');

    await userEvent.hover(esiButton.parentElement);
    expect(led).toHaveClass('bg-foreground/20');
  });
});

describe('EegViewer — bad channel filtering', () => {
  it('hides a channel from the waveform view once marked bad and applied', async () => {
    await renderViewer();
    channelNames.forEach((name) => expect(screen.getByText(name)).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'Montage' }));
    await userEvent.click(screen.getByTestId('channel-bad-EEG2'));
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(screen.getByText('EEG1')).toBeTruthy();
    expect(screen.queryByText('EEG2')).toBeNull();
    expect(screen.getByText('EEG3')).toBeTruthy();
  });

  it("still shows the remaining channels' own data after a bad channel is hidden", async () => {
    // Within the default 20s window, EEG3's values are [7,8,9] — distinct from EEG1's
    // [1,2,3] and EEG2's [4,5,6]. If hiding EEG2 shifted the remaining rows' indices
    // instead of preserving each row's original index, EEG3 would render EEG2's data.
    const { default: UplotReactMock } = await import('uplot-react');
    await renderViewer();

    await userEvent.click(screen.getByRole('button', { name: 'Montage' }));
    await userEvent.click(screen.getByTestId('channel-bad-EEG2'));
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    // Search from the most recent render backward, so a stale call from before the
    // commit can't hide a regression in the post-commit render.
    const eeg3Call = [...UplotReactMock.mock.calls]
      .reverse()
      .find((call) => call[0].data?.[1]?.includes(7));
    expect(eeg3Call).toBeTruthy();
    expect(Array.from(eeg3Call[0].data[1])).toEqual([7, 8, 9]);
  });
});

// ── Montage row wiring ──────────────────────────────────────────────────────
// CHANNEL_DATA per sample, within the default 20s window: EEG1=[1,2,3], EEG2=[4,5,6].

describe('EegViewer — montage row wiring', () => {
  it('falls back to the plain non-bad channel list when no montage rows are configured', async () => {
    await renderViewer();

    await userEvent.click(screen.getByRole('button', { name: 'Montage' }));
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    channelNames.forEach((name) => expect(screen.getByText(name)).toBeTruthy());
  });

  it('displays only the configured montage rows once any are added, instead of the full channel list', async () => {
    await renderViewer();

    await userEvent.click(screen.getByRole('button', { name: 'Montage' }));
    await userEvent.click(screen.getByTestId('channel-select-EEG1'));
    await userEvent.click(screen.getByTestId('add-selected-button'));
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(screen.getByText('EEG1')).toBeTruthy();
    expect(screen.queryByText('EEG2')).toBeNull();
    expect(screen.queryByText('EEG3')).toBeNull();
  });

  it('names a bipolar montage row "channel - reference" and plots channel-minus-reference data', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const { container } = await renderViewer();

    await userEvent.click(screen.getByRole('button', { name: 'Montage' }));
    await userEvent.click(screen.getByTestId('channel-select-EEG1'));
    await userEvent.click(screen.getByTestId('add-selected-button'));

    const referenceSelect = container.querySelector('[data-testid^="reference-"]');
    await userEvent.selectOptions(referenceSelect, 'EEG2');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(screen.getByText('EEG1 - EEG2')).toBeTruthy();

    // EEG1=[1,2,3], EEG2=[4,5,6] → EEG1 - EEG2 = [-3,-3,-3]
    const rowCall = [...UplotReactMock.mock.calls]
      .reverse()
      .find((call) => call[0].data?.[1]?.length === 3);
    expect(rowCall).toBeTruthy();
    expect(Array.from(rowCall[0].data[1])).toEqual([-3, -3, -3]);
  });

  it('does not display a montage row whose source channel is bad', async () => {
    await renderViewer();

    await userEvent.click(screen.getByRole('button', { name: 'Montage' }));
    await userEvent.click(screen.getByTestId('channel-select-EEG1'));
    await userEvent.click(screen.getByTestId('add-selected-button'));
    await userEvent.click(screen.getByTestId('channel-bad-EEG1'));
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(screen.queryByText('EEG1')).toBeNull();
  });

  it('does not display a montage row whose reference channel is bad', async () => {
    const { container } = await renderViewer();

    await userEvent.click(screen.getByRole('button', { name: 'Montage' }));
    await userEvent.click(screen.getByTestId('channel-select-EEG1'));
    await userEvent.click(screen.getByTestId('add-selected-button'));

    const referenceSelect = container.querySelector('[data-testid^="reference-"]');
    await userEvent.selectOptions(referenceSelect, 'EEG2');
    await userEvent.click(screen.getByTestId('channel-bad-EEG2'));
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(screen.queryByText('EEG1 - EEG2')).toBeNull();
    expect(screen.queryByText('EEG1')).toBeNull();
  });
});

// ── Montage row color wiring ────────────────────────────────────────────────

describe('EegViewer — montage row color wiring', () => {
  it('uses the light-mode default stroke color when a montage row has no color set', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    UplotReactMock.mockClear();
    await renderViewer();

    const call = UplotReactMock.mock.calls[0][0];
    expect(call.options.series[1].stroke).toBe('rgba(0, 0, 0, 0.8)');
  });

  it('uses the dark-mode default stroke color when a montage row has no color set', async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    themeState.isDarkMode = true;
    UplotReactMock.mockClear();
    await renderViewer();

    const call = UplotReactMock.mock.calls[0][0];
    expect(call.options.series[1].stroke).toBe('rgba(255, 255, 255, 0.8)');
  });

  it("uses a montage row's selected color as its plotted line color, overriding the theme default", async () => {
    const { default: UplotReactMock } = await import('uplot-react');
    const { container } = await renderViewer();

    await userEvent.click(screen.getByRole('button', { name: 'Montage' }));
    await userEvent.click(screen.getByTestId('channel-select-EEG1'));
    await userEvent.click(screen.getByTestId('add-selected-button'));

    const colorSelect = container.querySelector('[data-testid^="color-"]');
    await userEvent.selectOptions(colorSelect, 'red');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    const rowCall = [...UplotReactMock.mock.calls]
      .reverse()
      .find((call) => call[0].options?.series?.[1]?.stroke === 'red');
    expect(rowCall).toBeTruthy();
  });
});
