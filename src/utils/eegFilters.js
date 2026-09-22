import Fili from 'fili';

/**
 * Calculates Butterworth highpass biquad cascade coefficients.
 *
 * @param {number} fs - Sampling frequency in Hz.
 * @param {number} fc - Cutoff frequency in Hz.
 * @param {number} [order=4] - Number of cascaded biquad sections (fili caps this at 12).
 * @returns {Array<{ z: number[], a: number[], b: number[], a0: number, k: number }>} One coefficient section per cascade stage.
 */
export function getHighPassCoeff(fs, fc, order = 4) {
  //  Instance of a filter coefficient calculator
  const iirCalculator = new Fili.CalcCascades();

  // calculate highPass filter coefficients
  return iirCalculator.highpass({
    order: order, // cascade 4 biquad filters (max: 12)
    characteristic: 'butterworth',
    Fs: fs, // sampling frequency
    Fc: fc, // cutoff frequency / center frequency for bandpass, bandstop, peak
    BW: 1, // bandwidth only for bandstop and bandpass filters - optional
    gain: 0, // gain for peak, lowshelf and highshelf
    preGain: false, // adds one constant multiplication for highpass and lowpass
    // k = (1 + cos(omega)) * 0.5 / k = 1 with preGain == false
  });
}

/**
 * Calculates Butterworth lowpass biquad cascade coefficients.
 *
 * @param {number} fs - Sampling frequency in Hz.
 * @param {number} fc - Cutoff frequency in Hz.
 * @param {number} [order=4] - Number of cascaded biquad sections (fili caps this at 12).
 * @returns {Array<{ z: number[], a: number[], b: number[], a0: number, k: number }>} One coefficient section per cascade stage.
 */
export function getLowPassCoeff(fs, fc, order = 4) {
  //  Instance of a filter coefficient calculator
  const iirCalculator = new Fili.CalcCascades();

  // calculate lowPass filter coefficients
  return iirCalculator.lowpass({
    order: order, // cascade 4 biquad filters (max: 12)
    characteristic: 'butterworth',
    Fs: fs, // sampling frequency
    Fc: fc, // cutoff frequency / center frequency for bandpass, bandstop, peak
    BW: 1, // bandwidth only for bandstop and bandpass filters - optional
    gain: 0, // gain for peak, lowshelf and highshelf
    preGain: false, // adds one constant multiplication for highpass and lowpass
    // k = (1 + cos(omega)) * 0.5 / k = 1 with preGain == false
  });
}

/**
 * Calculates Butterworth notch (bandstop) biquad cascade coefficients, centered on `fc`. Unlike
 * highpass/lowpass, fili's cascade `order` widens a bandstop's stopband rather than steepening
 * it (cascading several BW=1 bandstop sections was measured to span ~20-120Hz around a 50Hz
 * center — far too broad for a mains notch), so this defaults to a single narrow-BW section
 * instead of inheriting the highpass/lowpass order=4 default. order=1, BW=0.1 measured at
 * ~3Hz wide at -3dB around a 50Hz center, close to the ~1.7-2Hz mains-notch target.
 *
 * @param {number} fs - Sampling frequency in Hz.
 * @param {number} fc - Notch center frequency in Hz (e.g. 50 or 60 for mains noise).
 * @param {number} [order=1] - Number of cascaded biquad sections (fili caps this at 12).
 * @returns {Array<{ z: number[], a: number[], b: number[], a0: number, k: number }>} One coefficient section per cascade stage.
 */
export function getBandStopCoeff(fs, fc, order = 1) {
  //  Instance of a filter coefficient calculator
  const iirCalculator = new Fili.CalcCascades();

  // calculate notch (bandstop) filter coefficients
  return iirCalculator.bandstop({
    order: order, // a single narrow section — see docstring for why this isn't 4 like highpass/lowpass
    characteristic: 'butterworth',
    Fs: fs, // sampling frequency
    Fc: fc, // cutoff frequency / center frequency for bandpass, bandstop, peak
    BW: 0.1, // narrow stopband tuned for mains-noise rejection (~3Hz wide at -3dB around 50Hz)
    gain: 0, // gain for peak, lowshelf and highshelf
    preGain: false, // adds one constant multiplication for highpass and lowpass
    // k = (1 + cos(omega)) * 0.5 / k = 1 with preGain == false
  });
}

/**
 * Composes one row's highpass, lowpass, and notch settings into a single biquad cascade.
 * Each is independently optional (`null` means off). Highpass, lowpass, and notch are
 * independent LTI filters, so cascading them is commutative — no need for a dedicated
 * bandpass design; a highpass section followed by a lowpass section produces the same result.
 *
 * @param {number} fs - Sampling frequency in Hz.
 * @param {number|null} highPass - Highpass cutoff in Hz, or `null` to skip.
 * @param {number|null} lowPass - Lowpass cutoff in Hz, or `null` to skip.
 * @param {number|null} notch - Notch center frequency in Hz, or `null` to skip.
 * @returns {Array<{ z: number[], a: number[], b: number[], a0: number, k: number }>} Concatenated coefficient sections for every filter that's set; empty if none are.
 */
export function buildFilterSections(fs, highPass, lowPass, notch) {
  const sections = [];

  if (highPass !== null) {
    sections.push(...getHighPassCoeff(fs, highPass));
  }
  if (lowPass !== null) {
    sections.push(...getLowPassCoeff(fs, lowPass));
  }
  if (notch !== null) {
    sections.push(...getBandStopCoeff(fs, notch));
  }

  return sections;
}

export function getTukeyWindow(M, alpha = 0.5) {
  // guards
  if (M <= 0) {
    throw new Error(`M must be bigger than 0, not ${M}`);
  }
  if (alpha <= 0) {
    return new Array(M).fill(1);
  }
  if (alpha >= 1) {
    throw new Error(`alpha must be within the range: 0 <= alpha <=1, not ${alpha}`);
  }

  // Taken from: scipy.signal.windows.tukey
  // https://github.com/scipy/scipy/blob/v1.18.0/scipy/signal/windows/_windows.py#L879-L964
  const indexArray = [...Array(M).keys()];
  const width = Math.floor((alpha * (M - 1)) / 2.0);
  const n1 = indexArray.slice(0, width + 1);
  const n2 = indexArray.slice(width + 1, M - width - 1);
  const n3 = indexArray.slice(M - width - 1);

  const w1 = n1.map((n) => 0.5 * (1 + Math.cos(Math.PI * (-1 + (2.0 * n) / alpha / (M - 1)))));
  const w2 = new Array(n2.length).fill(1);
  const w3 = n3.map(
    (n) => 0.5 * (1 + Math.cos(Math.PI * (-2.0 / alpha + 1 + (2.0 * n) / alpha / (M - 1))))
  );

  return w1.concat(w2).concat(w3);
}

/**
 * Applies a biquad cascade to a full signal via fili's built-in forward-backward
 * `IirFilter.filtfilt` (zero-phase, but with no edge padding of its own — see below). A no-op
 * fast path returns `samples` unchanged when `sections` is empty (nothing to filter).
 *
 * If `window` is given (a precomputed Tukey/Hann taper, e.g. flat 1s across the middle with
 * cosine-tapered edges), `samples` is zero-padded out to `window.length` — split as evenly as
 * possible before/after — and the result is multiplied pointwise by `window` before filtering.
 * This softens the zero-padding's edge discontinuity (a plain zero-pad's abrupt jump from 0 to
 * the signal's real starting value otherwise excites its own filter ringing) without the extra
 * bookkeeping of mirror/reflect padding. `window` must be at least as long as `samples`.
 *
 * @param {Float32Array|number[]} samples - The full signal to filter.
 * @param {Array<{ z: number[], a: number[], b: number[], a0: number, k: number }>} sections - Cascade sections, e.g. from buildFilterSections.
 * @param {number[]} [window] - Optional taper window, at least as long as `samples`; skips padding/windowing entirely when omitted.
 * @returns {number[]} Filtered signal, same length as `samples`.
 */
export function applyFilterSections(samples, sections, window) {
  // empty sections check => return unfiltered signal
  if (sections.length === 0) return samples;

  if (window && window.length < samples.length) {
    throw new Error('applyFilterSections: window must be at least as long as samples');
  }

  // zero-padding — pad samples out to the window's length, split as evenly as possible
  let padLengthBefore = 0;
  let padLengthAfter = 0; // default no padding when no window is set
  if (window) {
    padLengthBefore = Math.ceil((window.length - samples.length) / 2);
    padLengthAfter = Math.floor((window.length - samples.length) / 2);
  }
  const padded = new Array(padLengthBefore)
    .fill(0)
    .concat(Array.from(samples))
    .concat(new Array(padLengthAfter).fill(0));

  // apply Tukey/Hann window, if given
  const window_padded = window ? padded.map((value, index) => value * window[index]) : padded;

  const iirFilter = new Fili.IirFilter(sections); // fresh instance — don't reuse (delay state z isn't reset between filtfilt calls)
  const filtered = iirFilter.filtfilt(window_padded); // apply forward-backward filter to padded signal

  // slice away padding
  return filtered.slice(padLengthBefore, padLengthBefore + samples.length);
}

/**
 * Resolves one montage row's highPass/lowPass/notch settings into a filter cascade, then
 * applies it to the row's full signal — the row-aware, safe-by-default entry point on top of
 * the pure buildFilterSections/applyFilterSections primitives.
 *
 * Unlike applyFilterSections, omitting `window` here does NOT mean "no padding": a default
 * Tukey window (1 second of padding split before/after, alpha=0.1) is built automatically
 * whenever this row actually has a filter set, so callers get edge-transient protection
 * without having to think about it. Pass an explicit `window` instead when you already have
 * one built — e.g. to share a single window across many rows with the same buffered length,
 * rather than rebuilding an identical one per row.
 *
 * @param {Float32Array|number[]} samples - One row's full buffered signal.
 * @param {{highPass: number|null, lowPass: number|null, notch: number|null}} row - A montage row.
 * @param {number} fs - Sampling frequency in Hz.
 * @param {number[]} [window] - Optional taper window, at least as long as `samples`; a default is built when omitted.
 * @returns {number[]} Filtered signal, same length as `samples`.
 */
export function applyMontageRowFilter(samples, row, fs, window) {
  const sections = buildFilterSections(fs, row.highPass, row.lowPass, row.notch);
  if (sections.length === 0) return samples; // nothing to filter — skip building a default window too
  const resolvedWindow = window ?? getTukeyWindow(samples.length + fs, 0.1);
  return applyFilterSections(samples, sections, resolvedWindow);
}
