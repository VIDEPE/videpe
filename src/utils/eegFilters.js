var Fili = require('fili');

export function getHighPassCoeff(fs, fc, order=4) {
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
        preGain: false // adds one constant multiplication for highpass and lowpass
        // k = (1 + cos(omega)) * 0.5 / k = 1 with preGain == false
    });
}

export function getLowPassCoeff(fs, fc, order=4) {
    //  Instance of a filter coefficient calculator
    const iirCalculator = new Fili.CalcCascades();

    // calculate highPass filter coefficients
    return iirCalculator.lowPass({
        order: order, // cascade 4 biquad filters (max: 12)
        characteristic: 'butterworth',
        Fs: fs, // sampling frequency
        Fc: fc, // cutoff frequency / center frequency for bandpass, bandstop, peak
        BW: 1, // bandwidth only for bandstop and bandpass filters - optional
        gain: 0, // gain for peak, lowshelf and highshelf
        preGain: false // adds one constant multiplication for highpass and lowpass
        // k = (1 + cos(omega)) * 0.5 / k = 1 with preGain == false
    });
}

export function getBandStopCoeff(fs, fc, order=4) {
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
        preGain: false // adds one constant multiplication for highpass and lowpass
        // k = (1 + cos(omega)) * 0.5 / k = 1 with preGain == false
    });
}

export function getBandPassCoeff(fs, fc, order=4) {
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
        preGain: false // adds one constant multiplication for highpass and lowpass
        // k = (1 + cos(omega)) * 0.5 / k = 1 with preGain == false
    });
}

export function getFilter(fs, highPass, lowPass, notch) {

    if (highPass = lowPass = notch === null) {
        return null
    }

    // create a filter instance from the calculated coeffs
    const iirFilter = new Fili.IirFilter(iirFilterCoeffs);
}
