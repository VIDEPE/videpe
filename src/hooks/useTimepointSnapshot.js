import { useMemo, useEffect } from 'react';

/**
 * Derives the per-electrode and per-channel voltage snapshots at the clicked topography
 * timepoint, always referenced to the common average of the good (non-bad) channels (only
 * that one time point is referenced, not the whole buffer) — and lifts both upward so PatientView can build the intracranial
 * connectome layer (fires regardless of whether the topography window is open) and drive
 * Electrical Source Imaging (fires only on user clicks, not on every buffer refresh).
 * Unlike the montage editor's per-row references, this referencing isn't user-selectable —
 * topography/connectome/ESI always need the common-average reference, so it's unconditional.
 *
 * @param {Object} params
 * @param {Array<Float32Array|number[]>|null} params.channels - the raw (un-referenced)
 *   channel buffer for the currently visible window, or `null` before it's loaded.
 * @param {{average: number[]|null, median: number[]|null}|null} params.referenceSeries -
 *   the shared average/median series (see computeReferenceSeries in eegViewerUtils.js),
 *   computed once by the caller from non-bad channels — only `.average` is used here.
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
 *   Called only when the user clicks a new topography timepoint, so PatientView/ESI can
 *   recompute source power from the full per-channel snapshot.
 * @returns {Object} The average-referenced voltage snapshots:
 *   - `topoVoltages` (number[]) — one voltage per position-matched electrode at
 *     `topoTimepoint`, `[]` when there's nothing to show yet.
 *   - `topoVoltagesByChannel` (number[]) — one voltage per channel (not position-gated)
 *     at `topoTimepoint`, `[]` when there's nothing to show yet.
 */
export function useTimepointSnapshot({
  channels,
  referenceSeries,
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

  // Extract one average-referenced voltage per channel (not just position-matched ones) at
  // the clicked timepoint — drives the intracranial matrix, which has no position-file gate.
  const topoVoltagesByChannel = useMemo(() => {
    if (topoSampleIndex === null || !channels) return [];
    return snapshotVoltagesAt(channels, topoSampleIndex, referenceSeries?.average);
  }, [topoSampleIndex, channels, referenceSeries]);

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

  // Lift all-channel voltages for ESI — fires only when topoTimepoint changes (i.e. on
  // user clicks), NOT on every buffer refresh. Depending on topoVoltagesByChannel would
  // also fire whenever timestamps shift during buffer loads, causing rapid cascading
  // re-renders that supersede EegTopoViewer's async mesh load and leave it stuck loading.
  useEffect(() => {
    if (topoTimepoint === null || !channels || !timestamps?.length) return;
    const sampleIndex = Math.max(
      0,
      Math.min(timestamps.length - 1, Math.round((topoTimepoint - timestamps[0]) * fs))
    );
    const voltages = snapshotVoltagesAt(channels, sampleIndex, referenceSeries?.average);
    onChannelSnapshotChange?.({ isIntracranial, channelNames, channelTypes, voltages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topoTimepoint, isIntracranial, channelNames, channelTypes, onChannelSnapshotChange]);

  return { topoVoltages, topoVoltagesByChannel };
}

// One voltage per channel at `sampleIndex`, referenced to the common average at that sample.
// Only this one time point is referenced (a few hundred subtractions) instead of the whole buffer.
// There is no average only when every channel is marked bad; the raw voltages are returned then,
// but callers hide/zero bad channels anyway, so they never reach the screen.
// A missing channel/sample gives 0.
function snapshotVoltagesAt(channels, sampleIndex, average) {
  return channels.map((channel) => {
    const value = channel?.[sampleIndex];
    if (value === undefined) return 0;
    return average ? value - average[sampleIndex] : value;
  });
}
