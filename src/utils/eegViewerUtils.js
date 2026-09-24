import { parseElectrodeContactName } from './intracranialDetection';
import { getTukeyWindow, applyMontageRowFilter } from './eegFilters';
import { yieldToMain } from './yieldToMain';

// Once a filtering pass has worked this long without pausing, it yields to the browser — keeps
// each uninterrupted block comfortably under one frame (~16ms) so the app stays responsive
const FILTER_FRAME_BUDGET_MS = 8;

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
//   computeReferenceSeries(nonBad) → { average, median }   ← computed ONCE (only the
//           │                              │                   series in use — see
//           │                              │                   getNeededReferenceSeries)
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

/**
 * Computes the shared reference series everything below subtracts from channels set to
 * 'average'/'median' — one series per mode, computed once from `nonBadChannels` (the
 * caller has already excluded bad channels, since a bad channel's own noise/artifacts
 * shouldn't skew what everything else is referenced against).
 *
 * Each series is only computed when requested (see getNeededReferenceSeries) — on a large
 * buffer the median in particular is expensive, so skipping an unused one matters.
 *
 * @param {number[][]} nonBadChannels - one array of samples per non-bad channel; all
 *   channels must have the same length.
 * @param {{ needsAverage?: boolean, needsMedian?: boolean }} [needed] - which series to
 *   compute; both by default.
 * @returns {{ average: number[]|null, median: number[]|null }} one value per sample,
 *   averaged/medianed across channels; null for a series that wasn't requested, and both
 *   null when there are no channels to reference against (e.g. every channel is marked bad).
 */
export function computeReferenceSeries(
  nonBadChannels,
  { needsAverage = true, needsMedian = true } = {}
) {
  if (nonBadChannels.length === 0) return { average: null, median: null };
  return {
    average: needsAverage ? computeAverageSeries(nonBadChannels) : null,
    median: needsMedian ? computeMedianSeries(nonBadChannels) : null,
  };
}

// Channel-by-channel (not time-point-by-time-point), so each channel's samples are read in
// order — much faster than gathering all channels' values per time point.
function computeAverageSeries(channels) {
  const nSamples = channels[0].length;
  const series = new Array(nSamples).fill(0);
  // sum all channels' values at each time point
  for (const chan of channels) {
    for (let iSample = 0; iSample < nSamples; iSample++) {
      series[iSample] += chan[iSample];
    }
  }
  // divide each time point's sum by the channel count to get the average
  for (let iSample = 0; iSample < nSamples; iSample++) {
    series[iSample] /= channels.length;
  }
  return series;
}

// Reuses one scratch array for every time point, and finds the middle value with
// selectKthSmallest instead of fully sorting all channels' values each time.
function computeMedianSeries(channels) {
  const nChannels = channels.length;
  const nSamples = channels[0].length;
  // position of the middle value once sorted (the upper of the two middles for an even count)
  const mid = Math.floor(nChannels / 2);
  // created once and overwritten for every time point, instead of a new array each time
  const scratch = new Float64Array(nChannels);
  const series = new Array(nSamples); // one median value per time point
  for (let iSample = 0; iSample < nSamples; iSample++) {
    // copy every channel's value at this time point into the scratch array
    for (let ch = 0; ch < nChannels; ch++) scratch[ch] = channels[ch][iSample];
    // find the value that would sit at position `mid` if the scratch array were sorted
    const upperMiddle = selectKthSmallest(scratch, mid);
    if (nChannels % 2 === 1) {
      // odd channel count: there is exactly one middle value, which is the median
      series[iSample] = upperMiddle;
    } else {
      // even channel count: the median is the average of the two middle values
      // selectKthSmallest leaves every value left of `mid` <= the upper middle, so the lower
      // middle value is simply the largest of those
      let lowerMiddle = scratch[0];
      for (let i = 1; i < mid; i++) if (scratch[i] > lowerMiddle) lowerMiddle = scratch[i];
      series[iSample] = (lowerMiddle + upperMiddle) / 2;
    }
  }
  return series;
}

// Quickselect: partially reorders `values` in place until values[k] holds the value that
// would be at index k if sorted, with smaller-or-equal values left of it. On average this
// touches each value about twice, instead of the many passes a full sort needs.
//
// Example: the median of [7, 1, 9, 2, 4] is the value at k = 2 (counting from 0) once sorted.
//   The pivot is always the value at the middle position of the part still being looked at.
//   pivot 9:  smaller left, larger right  → [7, 1, 4, 2, 9]
//             k = 2 is in the left part    → keep [7, 1, 4, 2], drop [9]
//   pivot 1:  smaller left, larger right  → [1, 7, 4, 2]
//             k = 2 is in the right part   → keep [7, 4, 2] (positions 1-3), drop [1]
//   pivot 4:  smaller left, larger right  → [2, 4, 7]
//             the pivot itself landed on position 2 → done: everything left of it is
//             smaller and everything right of it is larger, so 4 already sits exactly
//             where it would in the fully sorted array
//   result: [1, 2, 4, 7, 9] → values[2] = 4 is the median
function selectKthSmallest(values, k) {
  // [left, right] is the part of the array that still has to be sorted out; it starts as the whole array
  let left = 0;
  let right = values.length - 1;
  while (left < right) {
    // pick the value in the middle of the remaining part as the pivot
    const pivot = values[Math.floor((left + right) / 2)];
    // i walks in from the left, j from the right
    let i = left;
    let j = right;
    // move values smaller than the pivot to the left side and larger ones to the right side
    while (i <= j) {
      while (values[i] < pivot) i++; // skip values already on the correct (left) side
      while (values[j] > pivot) j--; // skip values already on the correct (right) side
      // values[i] belongs on the right and values[j] on the left: swap them
      if (i <= j) {
        const tmp = values[i];
        values[i] = values[j];
        values[j] = tmp;
        i++;
        j--;
      }
    }
    // now everything up to j is <= pivot and everything from i onward is >= pivot:
    // keep only the side that contains position k and throw the other side away
    if (k <= j) right = j;
    else if (k >= i) left = i;
    else break; // k landed among values equal to the pivot — already in place
  }
  // the remaining part has shrunk to position k alone, which now holds the kth smallest value
  return values[k];
}

/**
 * Decides which reference series are actually used right now, so computeReferenceSeries
 * can skip the rest.
 *
 * @param {{ referenceMode: 'average'|'median'|null }[]} displayRows - from buildMontageDisplayRows.
 * @param {boolean} isSnapshotShown - whether a timepoint snapshot (topography/connectome/ESI)
 *   is shown; those always use the common average reference.
 * @returns {{ needsAverage: boolean, needsMedian: boolean }}
 */
export function getNeededReferenceSeries(displayRows, isSnapshotShown) {
  return {
    // needsAverage (boolean): needed when a snapshot is shown (it always uses the average) or any row references Avg
    needsAverage: isSnapshotShown || displayRows.some((row) => row.referenceMode === 'average'),
    // needsMedian (boolean): needed only when any row references Med
    needsMedian: displayRows.some((row) => row.referenceMode === 'median'),
  };
}

/**
 * Subtracts an already-computed reference series (see computeReferenceSeries above)
 * from every channel — the "apply to ALL channels" half of the diagram above, used by
 * applyMontage to re-reference the whole buffer for topography/connectome/ESI.
 *
 * @param {number[][]} channels - one array of samples per channel.
 * @param {number[]|null} series - the reference series to subtract (`average` or `median`
 *   from computeReferenceSeries), or null when there was nothing to reference against, in
 *   which case `channels` is returned unchanged rather than subtracting nothing meaningful.
 * @returns {number[][]} `channels`, each re-referenced against `series`.
 */
export function applyReferenceSeries(channels, series) {
  if (!series) return channels;
  return channels.map((chan) => chan.map((value, iSamp) => value - series[iSamp]));
}

// Reference values a montage row can carry besides a real channel name — resolved against
// computeReferenceSeries's shared series, not a channel index (see deriveMontageRowSamples).
const REFERENCE_LABELS = { average: 'Avg', median: 'Med' };
const SPECIAL_REFERENCES = Object.keys(REFERENCE_LABELS);

/**
 * Builds the rows to render in the EEG channel-plot area, resolving channel/reference
 * indices for deriveMontageRowSamples. Drops rows that are bad, or (only reachable via a
 * loaded montage file) name a channel not in channelNames — indexOf would return -1 there,
 * which deriveMontageRowSamples would crash on.
 *
 * @param {string[]} channelNames - the recording's channel names.
 * @param {Object.<string, {bad?: boolean}>} channelSettings - per-channel settings, keyed
 *   by channel name; only `bad` is read here.
 * @param {{id, channel: string, reference: string|null, color: string|null}[]} montageChannels -
 *   the configured montage rows, or `[]` to fall back to one row per non-bad channel.
 * @returns {{
 *   id: string,
 *   name: string,
 *   channelIndex: number,
 *   referenceIndex: number|null,
 *   referenceMode: 'average'|'median'|null,
 *   color: string|null
 * }[]}
 */
export function buildMontageDisplayRows(channelNames, channelSettings, montageChannels) {
  // No montage set => return all non-bad channel names
  if (montageChannels.length === 0) {
    return channelNames
      .map((name, index) => ({
        id: name, // unique id of this channel
        name: name, // name to display the display row with in uPlot
        channelIndex: index, // channel index
        referenceIndex: null, // channel index of the reference (if reference not n/a, average or median)
        referenceMode: null, // if reference is average / median, this field will indicate so
        color: null, // without montage the channels don't have a colour set
        highPass: null, // no highPass filter set without montage (null indicates off)
        lowPass: null, // no lowPass filter set without montage (null indicates off)
        notch: null, // no bandstop filter set without montage (null indicates off)
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
          highPass: row.highPass ?? null, // highPass frequency to filters buffered signal (null when not set)
          lowPass: row.lowPass ?? null, // lowPass frequency to filters buffered signal (null when not set)
          notch: row.notch ?? null, // bandstop frequency to filters buffered signal (null when not set)
        };
      })
  );
}

/**
 * Derives one display row's raw sample series from the raw (un-montaged) channel buffer —
 * the channel's own samples minus its reference's, or the channel as-is when the row has no
 * reference.
 *
 * @param {number[][]} channels - one array of samples per channel.
 * @param {{channelIndex: number, referenceIndex: number|null, referenceMode: string|null}} row -
 *   one row from buildMontageDisplayRows.
 * @param {{average: number[]|null, median: number[]|null}} [referenceSeries] - from
 *   computeReferenceSeries; resolves rows whose reference is 'average'/'median'. A
 *   channel-name reference instead looks the other channel up directly via `referenceIndex`.
 * @returns {number[]} the row's re-referenced samples, or the raw channel samples when
 *   there's no reference to apply (or no series available for the row's referenceMode).
 */
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

/**
 * Derives (see deriveMontageRowSamples) and filters every display row's full buffered signal,
 * one row at a time. Filtering a big montage takes seconds, so this pauses (see yieldToMain)
 * whenever it has worked `frameBudgetMs` without a break, keeping the app responsive.
 *
 * @param {Float32Array[]} channels - the raw buffered samples, one array per channel.
 * @param {{ id: string, highPass: number|null, lowPass: number|null, notch: number|null }[]} displayRows -
 *   from buildMontageDisplayRows.
 * @param {{ average: number[]|null, median: number[]|null }|null} referenceSeries - from
 *   computeReferenceSeries.
 * @param {number} fs - sampling frequency in Hz.
 * @param {{ signal?: AbortSignal, frameBudgetMs?: number }} [options] - `signal` cancels the pass
 *   (checked at the start and after every pause); `frameBudgetMs` is how long to work before
 *   pausing.
 * @returns {Promise<Map<string, Float32Array|number[]>>} each row's filtered samples, keyed by row
 *   id. A row without a filter keeps its derived samples as-is (no copy).
 * @throws {DOMException} an AbortError when `signal` is aborted.
 */
export async function filterMontageRows(
  channels,
  displayRows,
  referenceSeries,
  fs,
  { signal, frameBudgetMs = FILTER_FRAME_BUDGET_MS } = {}
) {
  signal?.throwIfAborted();

  // one Tukey window shared by every row (they all have the buffer's length), only built when
  // some row actually has a filter to apply it to
  const hasAnyFilter = displayRows.some(
    (row) => row.highPass !== null || row.lowPass !== null || row.notch !== null
  );
  const window = hasAnyFilter ? getTukeyWindow(channels[0].length + fs, 0.1) : undefined;

  const samplesByRowId = new Map();
  let burstStart = performance.now(); // when the current burst started, for the time budget
  for (let iRow = 0; iRow < displayRows.length; iRow++) {
    const row = displayRows[iRow];
    const raw = deriveMontageRowSamples(channels, row, referenceSeries);
    samplesByRowId.set(row.id, applyMontageRowFilter(raw, row, fs, window));

    // worked long enough without a break: pause, then stop here if a newer pass replaced this one
    // (no pause after the last row — there's nothing left to do, so just finish)
    const isLastRow = iRow === displayRows.length - 1;
    if (!isLastRow && performance.now() - burstStart >= frameBudgetMs) {
      await yieldToMain();
      signal?.throwIfAborted();
      burstStart = performance.now();
    }
  }

  return samplesByRowId;
}

/**
 * Compares two channel names for display ordering. Contact-shaped names ("E1", "E9", "b'7")
 * sort by their electrode group (case-insensitive prefix, apostrophe included) and then
 * numerically by contact number — so "E9" sorts before "E99" and "E100", where a plain string
 * compare would put "E100" and "E99" ahead of "E9". Falls back to plain localeCompare when
 * either name isn't contact-shaped (e.g. "ECG"), so non-electrode channels still sort somewhere
 * sensible instead of the comparator throwing or treating them as equal.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} negative/zero/positive, suitable for Array.prototype.sort.
 */
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

/**
 * Builds one bipolar reference per SEEG channel — contact N takes contact N+1 of its own
 * electrode group (matching prefix, so e.g. "B" and "B'" never cross-pair) as its reference,
 * only when that exact next contact exists (a gap is never bridged — see the "never skips a
 * missing contact" test). A contact with no such next-in-group partner comes back in
 * `monopolar` instead of `references`, for the caller to decide whether to keep it
 * unreferenced or drop it. EEG/Other-typed channels, and SEEG channels whose name isn't
 * contact-shaped (parseElectrodeContactName returns null), are left out of both entirely —
 * the former were never eligible, the latter have nothing to pair on.
 *
 * @param {string[]} channelNames - the recording's channel names.
 * @param {Object.<string, {type?: string}>} channelSettings - per-channel settings, keyed
 *   by channel name; a missing entry is treated as 'eeg' (never SEEG).
 * @returns {{ references: Map<string, string>, monopolar: string[] }} `references` maps
 *   each paired SEEG contact name to its N+1 reference; `monopolar` lists SEEG contacts
 *   with no such partner.
 */
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

/**
 * Resolves the 3D position a display row's channel-name label should move the NiiVue
 * crosshair to when clicked. A plain (unreferenced, or average/median-referenced) row
 * jumps to its own channel's electrode position; a bipolar row (referenced to another
 * real channel) jumps to the midpoint between the two electrodes instead.
 *
 * @param {{channelIndex: number, referenceIndex: number|null}} row - one row from
 *   buildMontageDisplayRows.
 * @param {{channelIdx: number, name: string, pos: {x:number,y:number,z:number}}[]} matched -
 *   from matchChannelsToPositions.
 * @returns {{x:number,y:number,z:number}|null} the position to move the crosshair to, or
 *   null when the row's own channel has no matched electrode position (a reference
 *   channel with no matched position just falls back to the primary channel's own
 *   position, rather than returning null).
 */
export function getRowCrosshairPosition(row, matched) {
  const channel = matched.find((channel) => channel.channelIdx === row.channelIndex);
  const reference = matched.find((channel) => channel.channelIdx === row.referenceIndex);

  if (channel === undefined) return null; // if channel is empty, return null
  const channelPos = channel.pos;

  if (reference === undefined) {
    // if reference is empty, then return the channel position
    return channelPos;
  }

  const referencePos = reference.pos;
  return {
    // if both channel and reference are in matched, then return the midpoint between the two electrodes
    x: (channelPos.x + referencePos.x) / 2,
    y: (channelPos.y + referencePos.y) / 2,
    z: (channelPos.z + referencePos.z) / 2,
  };
}
