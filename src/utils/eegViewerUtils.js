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

// Builds the list of rows to render in the EEG channel-plot area — either every non-bad
// channel, in their natural order (when no montage rows have been configured in the
// Montage Editor), or the configured montage rows, each carrying the channel/reference
// indices into channelNames needed to derive its displayed sample series (see
// deriveMontageRowSamples). A row is skipped when its source channel or (for bipolar
// rows) its reference channel is marked bad, since neither can produce meaningful data.
// `id` doubles as the React key: the channel name itself when falling back to the plain
// channel list (unique by construction), or the montage row's own uuid — needed there
// since two rows can derive from the same source channel.
export function buildMontageDisplayRows(channelNames, channelSettings, montageChannels) {
  if (montageChannels.length === 0) {
    return channelNames
      .map((name, index) => ({
        id: name,
        name: name,
        channelIndex: index,
        referenceIndex: null,
        color: null,
      }))
      .filter(({ name }) => !channelSettings[name]?.bad);
  }

  // channelSettings[row.reference] is simply undefined when reference is null/'' (no
  // such key), so this reads correctly for both referential and bipolar rows without a
  // separate "has a reference" guard.
  return montageChannels
    .filter((row) => !channelSettings[row.channel]?.bad && !channelSettings[row.reference]?.bad)
    .map((row) => ({
      id: row.id,
      name: row.reference ? `${row.channel} - ${row.reference}` : row.channel,
      channelIndex: channelNames.indexOf(row.channel),
      referenceIndex: row.reference ? channelNames.indexOf(row.reference) : null,
      color: row.color,
    }));
}

// Derives one display row's raw sample series from the (already whole-buffer-montaged)
// channel data — the channel's own samples minus its reference's, or the channel as-is
// when the row has no reference.
export function deriveMontageRowSamples(montagedChannels, row) {
  const channelSamples = montagedChannels[row.channelIndex];
  if (row.referenceIndex === null) return channelSamples;
  const referenceSamples = montagedChannels[row.referenceIndex];
  return channelSamples.map((v, i) => v - referenceSamples[i]);
}
