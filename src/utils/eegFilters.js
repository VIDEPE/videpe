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
 * Applies a montage row's filter cascade to its full signal via fili's built-in
 * forward-backward `IirFilter.filtfilt` (zero-phase, but with no edge padding of its own —
 * see below). A no-op fast path returns `samples` unchanged when `sections` is empty (no
 * filter set for this row).
 *
 * If `window` is given (a precomputed Tukey/Hann taper, e.g. flat 1s across the middle with
 * cosine-tapered edges), `samples` is zero-padded out to `window.length` — split as evenly as
 * possible before/after — and the result is multiplied pointwise by `window` before filtering.
 * This softens the zero-padding's edge discontinuity (a plain zero-pad's abrupt jump from 0 to
 * the signal's real starting value otherwise excites its own filter ringing) without the extra
 * bookkeeping of mirror/reflect padding. `window` must be at least as long as `samples`.
 *
 * @param {Float32Array|number[]} samples - One row's full buffered signal.
 * @param {Array<{ z: number[], a: number[], b: number[], a0: number, k: number }>} sections - Cascade sections, e.g. from buildFilterSections.
 * @param {number[]} [window] - Optional taper window, at least as long as `samples`; skips padding/windowing entirely when omitted.
 * @returns {number[]} Filtered signal, same length as `samples`.
 */
export function applyRowFilter(samples, sections, window) {
  // empty sections check => return unfiltered signal
  if (sections.length === 0) return samples;

  if (window && window.length < samples.length) {
    throw new Error('applyRowFilter: window must be at least as long as samples');
  }

  let padLengthBefore = 0;
  let padLengthAfter = 0;

  // zero-padding — pad samples out to the window's length, split as evenly as possible
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



// /**
//  * Runs `samples` forward through a cascade of biquad sections, one section at a time (each
//  * section's output feeds the next section's input). Hand-written — never calls fili's own
//  * per-sample step API — since this runs across potentially 100+ montage rows and needs to
//  * be a tight, allocation-light loop.
//  *
//  * @param {Array<{ z: number[], a: number[], b: number[], a0: number, k: number }>} sections - Cascade sections, e.g. from buildFilterSections.
//  * @param {Float32Array|number[]} samples - Input signal.
//  * @returns {Float32Array} Filtered signal, same length as `samples`.
//  */
// export function applyBiquadCascade(sections, samples) {
//   // TODO: Direct Form II Transposed per section (standard difference equation — see Wikipedia
//   // "Digital biquad filter" § Direct Form 2, or scipy.signal.lfilter's docstring for the same
//   // recursion). State w1/w2 reset to 0 at the start of each section's pass over the *previous*
//   // section's output:
//   //   for each sample x[n]:
//   //     y[n] = b0*x[n] + w1
//   //     w1   = b1*x[n] - a1*y[n] + w2
//   //     w2   = b2*x[n] - a2*y[n]
//   //
//   // Coefficient mapping, verified against fili's own runtime filter code (node_modules/fili/
//   // dist/fili.min.js, iirFilter.js module — NOT documented in fili's README):
//   //   a1 = section.a[0], a2 = section.a[1]   (fili already divides these by a0 at design
//   //                                            time — do NOT divide by section.a0 again here)
//   //   b0 = section.k * section.b[0]
//   //   b1 = section.k * section.b[1]          (fold in the k gain factor up front — valid
//   //   b2 = section.k * section.b[2]           because scaling the input, the output, or b by
//   //                                            a constant k are provably identical for an LTI
//   //                                            system, and fili applies k by scaling the input)
// }

// /**
//  * Zero-phase filtering via forward-backward application (filtfilt): mirror-pads both ends of
//  * `samples`, runs `applyBiquadCascade` forward, reverses, runs forward again, reverses again,
//  * then trims the padding back off. Running the same cascade twice (once each direction)
//  * cancels the phase distortion a single causal IIR pass would introduce.
//  *
//  * @param {Array<{ z: number[], a: number[], b: number[], a0: number, k: number }>} sections - Cascade sections.
//  * @param {Float32Array|number[]} samples - Input signal.
//  * @returns {Float32Array} Zero-phase filtered signal, same length as `samples`.
//  */
// export function filtfilt(sections, samples) {
//   // TODO:
//   // 1. Pick a pad length long enough for the cascade's startup transient to settle within the
//   //    padding rather than the real signal (e.g. a small multiple of the total section count).
//   // 2. Mirror-pad `samples` at both ends (reflect around the edge samples).
//   // 3. forward  = applyBiquadCascade(sections, padded)
//   // 4. backward = applyBiquadCascade(sections, forward.slice().reverse())
//   // 5. result   = backward.reverse()
//   // 6. Trim the padding back off both ends and return.
// }
