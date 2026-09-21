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
 * Calculates Butterworth notch (bandstop) biquad cascade coefficients, centered on `fc`.
 *
 * @param {number} fs - Sampling frequency in Hz.
 * @param {number} fc - Notch center frequency in Hz (e.g. 50 or 60 for mains noise).
 * @param {number} [order=4] - Number of cascaded biquad sections (fili caps this at 12).
 * @returns {Array<{ z: number[], a: number[], b: number[], a0: number, k: number }>} One coefficient section per cascade stage.
 */
export function getBandStopCoeff(fs, fc, order = 4) {
  //  Instance of a filter coefficient calculator
  const iirCalculator = new Fili.CalcCascades();

  // calculate highPass filter coefficients
  return iirCalculator.bandstop({
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
