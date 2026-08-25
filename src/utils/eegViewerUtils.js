import { mean, median } from './arrayAndMatrixMathUtils';
import { parseElectrodeContactName } from './intracranialDetection';

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
//   deriveMontageRowSamples          applyReferenceSeries(channels, series.average)
//   (subtract from ONE row's channel,   (subtract from ALL channels — always the average,
//    per-row reference/mode)             unconditionally, via useTimepointSnapshot)
//           │                              │
//           ▼                              ▼
//      waveform plot                topoVoltages / connectome / ESI
//
// Neither side knows about the other's output — montage rows never feed topography/
// connectome/ESI, which always uses the common-average reference (never user-selectable).

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

// Compares two channel names for display ordering. Contact-shaped names ("E1", "E9", "b'7")
// sort by their electrode group (case-insensitive prefix, apostrophe included) and then
// numerically by contact number — so "E9" sorts before "E99" and "E100", where a plain string
// compare would put "E100" and "E99" ahead of "E9". Falls back to plain localeCompare when
// either name isn't contact-shaped (e.g. "ECG"), so non-electrode channels still sort somewhere
// sensible instead of the comparator throwing or treating them as equal.
export function compareChannelNamesNaturally(a, b) {
  const parsedA = parseElectrodeContactName(a);
  const parsedB = parseElectrodeContactName(b);
  // one of them doesn't fit the SEEG electrode name pattern: do normal string compare
  if (!parsedA || !parsedB) return a.localeCompare(b);
  // else first compare groups and if the same group then compare numberInGroup
  return parsedA.group !== parsedB.group
    ? parsedA.group.localeCompare(parsedB.group)
    : parsedA.numberInGroup - parsedB.numberInGroup;
}

// Builds one bipolar reference per SEEG channel — contact N takes contact N+1 of its own
// electrode group (matching prefix, so e.g. "B" and "B'" never cross-pair) as its reference,
// only when that exact next contact exists (a gap is never bridged — see the "never skips a
// missing contact" test). A contact with no such next-in-group partner comes back in
// `monopolar` instead of `references`, for the caller to decide whether to keep it
// unreferenced or drop it. EEG/Other-typed channels, and SEEG channels whose name isn't
// contact-shaped (parseElectrodeContactName returns null), are left out of both entirely —
// the former were never eligible, the latter have nothing to pair on.
export function buildSeegBipolarReferences(channelNames, channelSettings) {
  function isSeeg(name) {
    const type = channelSettings[name]?.type ?? 'eeg'; // fall back to 'eeg' when no type is set
    return type === 'seeg'; // channel type equal to 'seeg'?
  }

  // Index every SEEG contact by group and number up front: group -> Map(numberInGroup ->
  // channel name). channelNames isn't guaranteed to list contacts in numeric order, so a
  // single forward pass couldn't reliably answer "does B2 exist?" while standing on B1 —
  // this index lets the second pass below look that up in one step, in any channel order.
  const groups = new Map();
  for (const name of channelNames) {
    if (!isSeeg(name)) continue; // EEG/Other channels never enter the index

    const parsed = parseElectrodeContactName(name); // parse SEEG channel name, 'B1' in to group: 'B' and numberInGroup: '1'
    if (!parsed) continue; // not SEEG shaped name (e.g. "GND") — nothing to index it under => skip
    if (!groups.has(parsed.group)) groups.set(parsed.group, new Map()); // if new group is spotted, add a new inner map for the numberInGroup

    const group = groups.get(parsed.group); // get inner map of the group
    if (!group.has(parsed.numberInGroup)) group.set(parsed.numberInGroup, name); // if the group doesn't have this channel number add it, if not skip it => first name wins on a duplicate number
  }

  // Use the groups to find the adjecent channels (only the N+1 channel) within a group to set as ref
  const references = new Map();
  const monopolar = [];
  for (const name of channelNames) {
    if (!isSeeg(name)) continue; // EEG/Other channels: skip entirely, not even added to monopolar

    const parsed = parseElectrodeContactName(name); // again parse the SEEG channel name into group and numberInGroup
    if (!parsed) {
      monopolar.push(name); // SEEG but not contact-shaped — nothing to pair it on
      continue;
    }
    const nextName = groups.get(parsed.group)?.get(parsed.numberInGroup + 1); // exact N+1 in the same group, or undefined
    if (nextName)
      references.set(name, nextName); // paired: N references N+1
    else monopolar.push(name); // no exact N+1 in this group — last contact, or a gap
  }

  return { references, monopolar };
}
