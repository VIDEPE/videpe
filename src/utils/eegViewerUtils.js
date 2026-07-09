import { mean, median } from './arrayAndMatrixMathUtils';

// Re-reference by subtracting the channel mean. Standard default in EEG analysis.
export function averageReference(channels) {
  const nChannels = channels.length;
  const nSamples = channels[0].length;

  const sampleMeans = Array(nSamples);

  for (let iSample = 0; iSample < nSamples; iSample++) {
    const valuesAtSample = Array(nChannels);
    for (let iChan = 0; iChan < nChannels; iChan++) {
      valuesAtSample[iChan] = channels[iChan][iSample];
    }
    sampleMeans[iSample] = mean(valuesAtSample);
  }

  return channels.map((chan) => chan.map((value, iSamp) => value - sampleMeans[iSamp]));
}

// Re-reference by subtracting the channel median. More robust when one or more
// channels carry artifacts, since outliers don't shift the median.
export function medianReference(channels) {
  const nChannels = channels.length;
  const nSamples = channels[0].length;

  const sampleMedians = Array(nSamples);

  for (let iSample = 0; iSample < nSamples; iSample++) {
    const valuesAtSample = Array(nChannels);
    for (let iChan = 0; iChan < nChannels; iChan++) {
      valuesAtSample[iChan] = channels[iChan][iSample];
    }
    sampleMedians[iSample] = median(valuesAtSample);
  }

  return channels.map((chan) => chan.map((v, iSamp) => v - sampleMedians[iSamp]));
}

export function applyMontage(channels, montage) {
  return montage === 'median'
    ? medianReference(channels)
    : montage === 'average'
      ? averageReference(channels)
      : channels; // 'none' — use raw voltages without re-referencing
}
