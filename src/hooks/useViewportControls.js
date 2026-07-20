import { useState, useEffect } from 'react';

// Layout constant shared with the channel-plot area, used only to cap how many channels can fit
const MIN_PLOT_HEIGHT = 12; // minimum px per channel lane — prevents uPlot from collapsing at high channel counts

// Input length caps, used by the onChange handlers below to reject overly long typed values
const SHIFT_INPUT_MAX_LENGTH = 6; // covers up to 9999.9 s
const Y_INPUT_MAX_LENGTH = 5; // covers 0.0001 to 99999 µV
const Y_MAX = 10 ** Y_INPUT_MAX_LENGTH - 1; // 99999 — derived from Y_INPUT_MAX_LENGTH so both stay in sync
const Y_MIN = 10 ** -(Y_INPUT_MAX_LENGTH - 2); // 0.001 minimum range (with Y_INPUT_MAX_LENGTH char length) to prevent uPlot from breaking with a zero or negative y-range

/**
 * Owns the EEG viewer's viewport controls — visible channel count, x-range (window size +
 * start time), time-step size, and y-range (voltage scale) — plus the input change/blur
 * handlers and increment helpers the controls row wires up to. Values are clamped against
 * each other (e.g. shift step can never exceed window size, channel count can never
 * exceed how many lanes fit in the measured plot area) so the UI can never be driven into
 * an inconsistent state.
 *
 * @param {Object} params
 * @param {number} params.tMax - total recording duration in seconds; caps window size and
 *   start time.
 * @param {number} params.channelCount - total number of channels in the recording; caps
 *   visible channel count.
 * @param {number} params.channelAreaHeight - measured pixel height of the scrollable
 *   channel-plot area; used with MIN_PLOT_HEIGHT to cap how many channel lanes can fit,
 *   and to re-clamp the visible count whenever the pane is resized.
 * @returns {Object} The current viewport state, plus the functions/handlers to drive it:
 *   - `visibleChannelCount`/`visibleChannelCountStr` (number/string) — how many channels
 *     are shown at once, and the input's editable string form.
 *   - `windowSize`/`windowSizeStr` (number/string) — seconds visible in the x-range.
 *   - `startTime` (number) — start of the visible x-range, in seconds.
 *   - `setStartTime` (value|updater) => void — raw setter, for direct control (scrubber
 *     drag, keyboard Home/End/PageUp/PageDown).
 *   - `shiftTimeStepSize`/`shiftTimeStepSizeStr` (number/string) — seconds moved per
 *     forward/backward step.
 *   - `yScale`/`yScaleStr` (number/string) — y-axis half-range in µV, shared by all
 *     channels.
 *   - `updateVisibleChannelCount`/`updateWindowSize`/`updateShiftTimeStepSize`/`updateYScale`
 *     (newVal: number) => void — clamp, round, and apply a new value (and sync its Str
 *     twin); used by the +/- buttons and zoom buttons.
 *   - `onVisibleChannelCountChange`/`onWindowSizeChange`/`onShiftTimeStepChange`/`onYScaleChange`
 *     (e: InputEvent) => void — input onChange handlers: reject overly long input, update
 *     the Str state live, and apply the numeric value only while it parses.
 *   - `onVisibleChannelCountBlur`/`onWindowSizeBlur`/`onShiftTimeStepBlur`/`onYScaleBlur`
 *     () => void — input onBlur handlers: re-apply the current Str value through the
 *     corresponding updateX (falling back to the last valid value), snapping the input
 *     back to a clamped, well-formatted number.
 *   - `increaseWindowSize`/`decreaseWindowSize` () => void — step window size by 10s.
 *   - `forwardshiftStartTime`/`backwardshiftStartTime` () => void — pan start time by
 *     `shiftTimeStepSize`.
 */
export function useViewportControls({ tMax, channelCount, channelAreaHeight }) {
  // ── Visible channel count ────────────────────────────────────────────────
  const defaultVisibleChannelCount = 20;
  const [visibleChannelCount, setVisibleChannelCount] = useState(defaultVisibleChannelCount);
  const [visibleChannelCountStr, setVisibleChannelCountStr] = useState(
    String(defaultVisibleChannelCount)
  );

  // Input length caps that depend on props, so they can't be module-level constants
  const CHANNEL_INPUT_MAX_LENGTH = String(channelCount).length; // enough to display the max channel count, e.g. "128"
  const WINDOW_INPUT_MAX_LENGTH = String(Math.ceil(tMax)).length + 2; // enough to display the max window size (tMax) with a comma + 1 decimal

  // ── Window size + start time (x-range) ───────────────────────────────────
  // Default to showing the full recording if it's shorter than 20s, otherwise start with a
  // 20s window. For a short recording, floor tMax to 1 decimal: this keeps the window ≤ tMax
  // (a window LARGER than the recording made the scrubber thumb exceed 100% and overflow to
  // the right, dragging in a horizontal scrollbar) AND matches the 1-decimal value the input
  // snaps to on blur, so a non-integer tMax (e.g. 6.01171875s) shows a clean "6" not the full
  // float. floor (not round) so rounding can never nudge it back above tMax.
  const defaultWindowSize = tMax < 20 ? Math.floor(tMax * 10) / 10 : 20;
  const [windowSize, setWindowSize] = useState(defaultWindowSize); // seconds visible in the x-range, initialized to 20s or the full recording if shorter
  const [windowSizeStr, setWindowSizeStr] = useState(String(defaultWindowSize));

  const [startTime, setStartTime] = useState(0); // start of the visible x-range

  // ── Time step (pan increment) ────────────────────────────────────────────
  const defaultShiftTimeStepSize = 5;
  const [shiftTimeStepSize, setShiftTimeStepSize] = useState(defaultShiftTimeStepSize);
  const [shiftTimeStepSizeStr, setShiftTimeStepSizeStr] = useState(
    String(defaultShiftTimeStepSize)
  );

  // ── Y-scale (voltage range) ──────────────────────────────────────────────
  const defaultYScale = 0.15;
  const [yScale, setYScale] = useState(defaultYScale); // y-axis half-range in µV; all channels share this
  const [yScaleStr, setYScaleStr] = useState(String(defaultYScale)); // separate state for the input string to allow temporary invalid states (e.g. empty string while editing) without breaking the numeric yScale used for plotting

  // ── Clamp helpers ─────────────────────────────────────────────────────────
  // Clamp the visible channel count to a valid range whenever channelCount or the count changes
  const maxChannelsByHeight =
    channelAreaHeight > 0 ? Math.floor(channelAreaHeight / MIN_PLOT_HEIGHT) : channelCount;
  const clampChannelCount = (n) => Math.max(1, Math.min(channelCount, maxChannelsByHeight, n));

  // ── Update functions — clamp/round a new value and sync its Str twin ────
  // Used directly by the +/- and zoom buttons, and as the fallback path for the onBlur
  // handlers below.
  const updateYScale = (newVal) => {
    const rounded_newVal =
      Math.round(newVal * 10 ** (Y_INPUT_MAX_LENGTH - 2)) / 10 ** (Y_INPUT_MAX_LENGTH - 2);
    const clamped = Math.max(Y_MIN, Math.min(Y_MAX, rounded_newVal));
    setYScale(clamped);
    setYScaleStr(String(clamped));
  };
  const updateWindowSize = (newVal) => {
    const clamped = Math.round(Math.min(tMax, Math.max(1, newVal)) * 10) / 10;
    setWindowSize(clamped);
    setWindowSizeStr(String(clamped));
    // If the new window size would push the right edge past tMax, pull startTime back
    setStartTime((prev) => Math.max(0, Math.min(prev, tMax - clamped)));
    // Shift step must never exceed window size — clamp it down if needed
    if (shiftTimeStepSize > clamped) {
      setShiftTimeStepSize(clamped);
      setShiftTimeStepSizeStr(String(clamped));
    }
  };
  const updateShiftTimeStepSize = (newVal) => {
    const clamped = Math.max(1, Math.min(windowSize, Math.round(newVal * 10) / 10));
    setShiftTimeStepSize(clamped);
    setShiftTimeStepSizeStr(String(clamped));
  };
  const updateVisibleChannelCount = (newVal) => {
    const clamped = clampChannelCount(Math.round(newVal));
    setVisibleChannelCount(clamped);
    setVisibleChannelCountStr(String(clamped));
  };

  // Re-clamp channel count whenever the container height changes (e.g. window resize, split-pane drag)
  useEffect(() => {
    updateVisibleChannelCount(visibleChannelCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelAreaHeight]);

  // ── Input change/blur handlers — wire directly to the controls' <input> elements ──
  const onVisibleChannelCountChange = (e) => {
    if (e.target.value.length > CHANNEL_INPUT_MAX_LENGTH) return;
    setVisibleChannelCountStr(e.target.value);
    const val = Number(e.target.value);
    if (e.target.value !== '' && !isNaN(val))
      setVisibleChannelCount(clampChannelCount(Math.round(val)));
  };
  const onVisibleChannelCountBlur = () =>
    updateVisibleChannelCount(Number(visibleChannelCountStr) || visibleChannelCount);

  const onWindowSizeChange = (e) => {
    if (e.target.value.length > WINDOW_INPUT_MAX_LENGTH) return;
    setWindowSizeStr(e.target.value);
    const val = Number(e.target.value);
    if (e.target.value !== '' && !isNaN(val) && val > 0)
      setWindowSize(Math.max(1, Math.min(tMax, val)));
  };
  const onWindowSizeBlur = () => updateWindowSize(Number(windowSizeStr) || windowSize);

  const onShiftTimeStepChange = (e) => {
    if (e.target.value.length > SHIFT_INPUT_MAX_LENGTH) return;
    setShiftTimeStepSizeStr(e.target.value);
    const val = Number(e.target.value);
    if (e.target.value !== '' && !isNaN(val))
      setShiftTimeStepSize(Math.max(1, Math.min(windowSize, Math.round(val * 10) / 10)));
  };
  const onShiftTimeStepBlur = () =>
    updateShiftTimeStepSize(Number(shiftTimeStepSizeStr) || shiftTimeStepSize);

  const onYScaleChange = (e) => {
    if (e.target.value.length > Y_INPUT_MAX_LENGTH) return;
    setYScaleStr(e.target.value);
    const val = Number(e.target.value);
    if (e.target.value !== '' && !isNaN(val)) setYScale(Math.max(Y_MIN, val));
  };
  const onYScaleBlur = () => updateYScale(Number(yScaleStr) || yScale);

  // ── Step helpers — used by the zoom/pan buttons and keyboard shortcuts ──
  const increaseWindowSize = () => updateWindowSize(Math.floor(windowSize) + 10);
  const decreaseWindowSize = () => updateWindowSize(Math.max(1, Math.floor(windowSize) - 10));

  const forwardshiftStartTime = () => {
    setStartTime((start) => Math.min(tMax - windowSize, start + shiftTimeStepSize));
  };
  const backwardshiftStartTime = () => {
    setStartTime((start) => Math.max(0, start - shiftTimeStepSize));
  };

  return {
    // Raw state + Str twins for each control
    visibleChannelCount,
    visibleChannelCountStr,
    windowSize,
    windowSizeStr,
    startTime,
    shiftTimeStepSize,
    shiftTimeStepSizeStr,
    yScale,
    yScaleStr,
    // Raw setters — for callers that need to bypass the clamped updateX path (scrubber drag, keyboard shortcuts)
    setStartTime,
    setWindowSize,
    setWindowSizeStr,
    // Clamp-and-apply functions — used by the +/- and zoom buttons
    updateVisibleChannelCount,
    updateWindowSize,
    updateShiftTimeStepSize,
    updateYScale,
    // Input change/blur handlers — wire directly to the controls row's <input> elements
    onVisibleChannelCountChange,
    onVisibleChannelCountBlur,
    onWindowSizeChange,
    onWindowSizeBlur,
    onShiftTimeStepChange,
    onShiftTimeStepBlur,
    onYScaleChange,
    onYScaleBlur,
    // Step helpers — used by the zoom/pan buttons and keyboard shortcuts
    increaseWindowSize,
    decreaseWindowSize,
    forwardshiftStartTime,
    backwardshiftStartTime,
  };
}
