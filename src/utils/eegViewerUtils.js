import { mean, median } from './arrayAndMatrixMathUtils';

// ─── EEG channel referencing ──────────────────────────────────────────────────────────
//
// Two independent pipelines re-reference EEG channels against the same shared
// average/median series (computed once from non-bad channels), but apply it differently:
//
//   raw channels + channelSettings (bad flags)
//           │
//           ▼
//      filter non-bad
//           │
//           ▼
//   computeReferenceSeries(nonBad) → { average, median }   ← computed ONCE
//           │                              │
//           ▼                              ▼
//   deriveMontageRowSamples          applyReferenceSeries(channels, series[montage])
//   (subtract from ONE row's channel)   (subtract from ALL channels, via applyMontage)
//           │                              │
//           ▼                              ▼
//      waveform plot                topoVoltages / connectome / ESI
//
// Neither side knows about the other's output — montage rows never feed topography/
// connectome/ESI, and the global montage select never touches the waveform display.

// The shared reference series everything below subtracts from channels set to
// 'average'/'median' — one series per mode, computed once from `nonBadChannels` (the
// caller has already excluded bad channels, since a bad channel's own noise/artifacts
// shouldn't skew what everything else is referenced against). Both are null when there
// are no channels to reference against (e.g. every channel is currently marked bad).
export function computeReferenceSeries(nonBadChannels) {
  if (nonBadChannels.length === 0) return { average: null, median: null };

  const nSamples = nonBadChannels[0].length;
  const averageSeries = Array(nSamples);
  const medianSeries = Array(nSamples);

  for (let iSample = 0; iSample < nSamples; iSample++) {
    const valuesAtSample = nonBadChannels.map((chan) => chan[iSample]);
    averageSeries[iSample] = mean(valuesAtSample);
    medianSeries[iSample] = median(valuesAtSample);
  }

  return { average: averageSeries, median: medianSeries };
}

// Subtracts an already-computed reference series (see computeReferenceSeries above)
// from every channel — the "apply to ALL channels" half of the diagram above, used by
// applyMontage to re-reference the whole buffer for topography/connectome/ESI. `series`
// is null when there was nothing to reference against (see computeReferenceSeries),
// in which case channels are returned unchanged rather than subtracting nothing meaningful.
export function applyReferenceSeries(channels, series) {
  if (!series) return channels;
  return channels.map((chan) => chan.map((value, iSamp) => value - series[iSamp]));
}

// Re-references the whole channel buffer for topography/connectome/ESI. `referenceSeries`
// is the { average, median } object from computeReferenceSeries — computed once by the
// caller from non-bad channels and shared with the waveform pipeline (see diagram above).
export function applyMontage(channels, montage, referenceSeries) {
  if (montage !== 'average' && montage !== 'median') return channels; // 'none' — raw voltages
  return applyReferenceSeries(channels, referenceSeries?.[montage]);
}

// Reference values a montage row can carry besides a real channel name — resolved against
// computeReferenceSeries's shared series, not a channel index (see deriveMontageRowSamples).
const REFERENCE_LABELS = { average: 'Avg', median: 'Med' };
const SPECIAL_REFERENCES = Object.keys(REFERENCE_LABELS);

// Builds the rows to render in the EEG channel-plot area, resolving channel/reference
// indices for deriveMontageRowSamples. Drops rows that are bad, or (only reachable via a
// loaded montage file) name a channel not in channelNames — indexOf would return -1 there,
// which deriveMontageRowSamples would crash on.
export function buildMontageDisplayRows(channelNames, channelSettings, montageChannels) {
  // No montage set => return all non-bad channel names
  if (montageChannels.length === 0) {
    return channelNames
      .map((name, index) => ({
        id: name,
        name: name,
        channelIndex: index,
        referenceIndex: null, // channel index of the reference (if reference not n/a, average or median)
        referenceMode: null, // if reference is average / median, this field will indicate so
        color: null,
      }))
      .filter(({ name }) => !channelSettings[name]?.bad);
  }

  // Montage is set:
  return (
    montageChannels
      // - filter out bad channels and bad references
      // note: channelSettings[row.reference] is simply undefined when reference is null/''
      .filter((row) => !channelSettings[row.channel]?.bad && !channelSettings[row.reference]?.bad)
      // filter out rows with channel/reference not present in the current recording
      .filter(
        (row) =>
          channelNames.includes(row.channel) &&
          (!row.reference ||
            SPECIAL_REFERENCES.includes(row.reference) ||
            channelNames.includes(row.reference))
      )
      // - create new names: [channel] - [ref] if there is a reference, else: row.channel
      //   if row.reference === 'average'/'median': [channel] - Avg / Med
      .map((row) => {
        const isSpecialReference = SPECIAL_REFERENCES.includes(row.reference);
        return {
          id: row.id,
          name: row.reference
            ? `${row.channel} - ${REFERENCE_LABELS[row.reference] ?? row.reference}`
            : row.channel,
          channelIndex: channelNames.indexOf(row.channel),
          referenceIndex:
            row.reference && !isSpecialReference ? channelNames.indexOf(row.reference) : null,
          referenceMode: isSpecialReference ? row.reference : null,
          color: row.color,
        };
      })
  );
}

// Derives one display row's raw sample series from the raw (un-montaged) channel buffer —
// the channel's own samples minus its reference's, or the channel as-is when the row has no
// reference. `referenceSeries` ({ average, median } from computeReferenceSeries) resolves
// rows whose reference is 'average'/'median'; a channel-name reference instead looks the
// other channel up directly via `referenceIndex`.
export function deriveMontageRowSamples(channels, row, referenceSeries) {
  const channelSamples = channels[row.channelIndex];
  // if no reference channel and no reference mode is selected: return the channelSamples as they are
  if (row.referenceIndex === null && row.referenceMode === null) return channelSamples;

  // if reference mode is set (average / median), substract the corresponding referenceSeries from the channel
  if (row.referenceMode) {
    const series = referenceSeries?.[row.referenceMode];
    if (!series) return channelSamples; // no non-bad channels to reference against — fall back to raw
    return channelSamples.map((v, i) => v - series[i]);
  }

  // else: substract the reference channel from the channel
  const referenceSamples = channels[row.referenceIndex];
  return channelSamples.map((v, i) => v - referenceSamples[i]);
}
