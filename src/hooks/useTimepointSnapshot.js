import { useMemo, useEffect } from 'react';

import { filterChannelsAtSample } from '@/utils/eegFilters';

/**
 * Derives the per-electrode and per-channel voltage snapshots at the clicked topography
 * timepoint, filtered with the global filters of each channel's type (see
 * filterChannelsAtSample — montage rows' own filters don't apply here) and then referenced to
 * the common average of the good (non-bad) channels (only that one time point is filtered and
 * referenced, not the whole buffer) — and lifts both upward so PatientView can build the intracranial
 * connectome layer (fires regardless of whether the topography window is open) and drive
 * Electrical Source Imaging (fires only on user clicks, not on every buffer refresh).
 * Unlike the montage editor's per-row references, this referencing isn't user-selectable —
 * topography/connectome/ESI always need the common-average reference, so it's unconditional.
 *
 * @param {Object} params
 * @param {Array<Float32Array|number[]>|null} params.channels - the raw (un-referenced)
 *   channel buffer for the currently visible window, or `null` before it's loaded.
 * @param {boolean[]} params.badChannelFlags - one bad flag per channelNames index; bad
 *   channels are left out of the common average. Must keep a stable identity (memoize it):
 *   a change re-fires onChannelSnapshotChange.
 * @param {Record<string, {highPass: number|null, lowPass: number|null, notch: number|null}>} params.globalFilters -
 *   the global filters per channel type, applied before referencing.
 * @param {number|null} params.topoTimepoint - the timestamp (seconds) the user last
 *   clicked in the channel plots, or `null` before any click.
 * @param {number[]|null} params.timestamps - sample timestamps for the current buffer,
 *   used to convert `topoTimepoint` into a sample index.
 * @param {number} params.fs - the recording's sampling rate, used for the same
 *   timestamp-to-sample-index conversion.
 * @param {Array<{channelIdx:number}>} params.matched - electrode-to-channel matches (from
 *   useElectrodeMatching); only matched channels contribute to `topoVoltages`.
 * @param {string[]} params.channelNames - all channel names, used for the lifted
 *   per-channel snapshot (which isn't limited to position-matched channels).
 * @param {(string|undefined)[]} params.channelTypes - one channelSettings type
 *   ('eeg'|'seeg'|'other'|undefined) per channelNames index — lets ESI reject a channel
 *   the inverse solution needs but that's itself typed SEEG, even if the name matches.
 * @param {boolean} params.isIntracranial - whether the majority of channels are currently
 *   typed SEEG (see EegViewer.jsx's majorityIsSeeg); passed through unchanged to both
 *   lifted snapshots.
 * @param {(snapshot: {isIntracranial: boolean, matched: Array, voltages: number[]}) => void} params.onElectrodeSnapshotChange
 *   Called whenever the electrode-matched voltage snapshot changes, so PatientView can
 *   rebuild the intracranial 3D connectome layer.
 * @param {(snapshot: {isIntracranial: boolean, channelNames: string[], channelTypes: Array, voltages: number[]}) => void} params.onChannelSnapshotChange
 *   Called when the user clicks a new topography timepoint, or when the channel types, bad
 *   channels or global filters change, so PatientView/ESI can recompute source power from the
 *   full per-channel snapshot — not on buffer refreshes alone.
 * @returns {Object} The filtered, average-referenced voltage snapshots:
 *   - `topoVoltages` (number[]) — one voltage per position-matched electrode at
 *     `topoTimepoint`, `[]` when there's nothing to show yet.
 *   - `topoVoltagesByChannel` (number[]) — one voltage per channel (not position-gated)
 *     at `topoTimepoint`, `[]` when there's nothing to show yet.
 */
export function useTimepointSnapshot({
  channels,
  badChannelFlags,
  globalFilters,
  topoTimepoint,
  timestamps,
  fs,
  matched,
  channelNames,
  channelTypes,
  isIntracranial,
  onElectrodeSnapshotChange,
  onChannelSnapshotChange,
}) {
  // Sample index shared by both voltage snapshots below.
  const topoSampleIndex = useMemo(() => {
    if (topoTimepoint === null || !timestamps?.length) return null;
    return Math.max(
      0,
      Math.min(timestamps.length - 1, Math.round((topoTimepoint - timestamps[0]) * fs))
    );
  }, [topoTimepoint, timestamps, fs]);

  // Extract one filtered, average-referenced voltage per channel (not just position-matched
  // ones) at the clicked timepoint — drives the intracranial matrix, which has no position-file gate.
  const topoVoltagesByChannel = useMemo(() => {
    if (topoSampleIndex === null || !channels) return [];
    return snapshotVoltagesAt(
      channels,
      topoSampleIndex,
      channelTypes,
      globalFilters,
      badChannelFlags,
      fs
    );
  }, [topoSampleIndex, channels, channelTypes, globalFilters, badChannelFlags, fs]);

  // Extract one voltage per matched channel at the same timepoint — drives the scalp mesh
  // and the intracranial 3D connectome (both need real x/y/z positions).
  const topoVoltages = useMemo(() => {
    if (!topoVoltagesByChannel.length || !matched.length) return [];
    return matched.map((m) => topoVoltagesByChannel[m.channelIdx] ?? 0);
  }, [topoVoltagesByChannel, matched]);

  // Lift the live electrode/voltage state up so PatientView can build the
  // intracranial connectome layer for the Neuroimaging pane — fires regardless of
  // whether the topography window itself is open, since the connectome auto-shows.
  useEffect(() => {
    onElectrodeSnapshotChange?.({ isIntracranial, matched, voltages: topoVoltages });
  }, [isIntracranial, matched, topoVoltages, onElectrodeSnapshotChange]);

  // Lift all-channel voltages for ESI — fires when topoTimepoint changes (i.e. on user
  // clicks) or the settings that change the values (types, bad channels, filters), NOT on
  // every buffer refresh. Depending on topoVoltagesByChannel would also fire whenever
  // timestamps shift during buffer loads, causing rapid cascading re-renders that supersede
  // EegTopoViewer's async mesh load and leave it stuck loading. It still reads
  // topoVoltagesByChannel (already up to date for this render), so a click filters only once.
  useEffect(() => {
    if (!topoVoltagesByChannel.length) return; // no click yet, or no buffer loaded
    onChannelSnapshotChange?.({
      isIntracranial,
      channelNames,
      channelTypes,
      voltages: topoVoltagesByChannel,
    });
    // topoVoltagesByChannel is left out on purpose — see the comment above this effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    topoTimepoint,
    isIntracranial,
    channelNames,
    channelTypes,
    badChannelFlags,
    globalFilters,
    onChannelSnapshotChange,
  ]);

  return { topoVoltages, topoVoltagesByChannel };
}

// One voltage per channel at `sampleIndex`: filtered with its type's global filters, then
// referenced to the common average of the good channels at that sample. Filtering first and
// referencing after gives the same result as the other way round, since both are linear.
// Only this one time point is referenced (a few hundred subtractions) instead of the whole buffer.
// There is no average only when every channel is marked bad; the filtered voltages are returned
// unreferenced then, but callers hide/zero bad channels anyway, so they never reach the screen.
// A missing channel/sample gives 0 before referencing (see filterChannelsAtSample).
function snapshotVoltagesAt(
  channels,
  sampleIndex,
  channelTypes,
  globalFilters,
  badChannelFlags,
  fs
) {
  const filtered = filterChannelsAtSample(channels, sampleIndex, channelTypes, globalFilters, fs);
  const goodValues = filtered.filter((_, index) => !badChannelFlags?.[index]);
  if (goodValues.length === 0) return filtered; // no average (0 / 0 = NaN) — callers hide/zero bad channels, so these values never reach the screen
  const average = goodValues.reduce((sum, value) => sum + value, 0) / goodValues.length;
  return filtered.map((value) => value - average);
}
