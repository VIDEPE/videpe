import { useMemo, useEffect } from 'react';
import { applyMontage } from '@/utils/eegViewerUtils';

/**
 * Applies the selected montage to the raw channel buffer, then derives the per-electrode
 * and per-channel voltage snapshots at the clicked topography timepoint — and lifts both
 * upward so PatientView can build the intracranial connectome layer (fires regardless of
 * whether the topography window is open) and drive Electrical Source Imaging (fires only
 * on user clicks, not on every buffer refresh).
 *
 * @param {Object} params
 * @param {Array<Float32Array|number[]>|null} params.channels - the raw (un-montaged)
 *   channel buffer for the currently visible window, or `null` before it's loaded.
 * @param {'none'|'average'|'median'} params.montage - the currently selected EEG
 *   reference montage, applied to `channels` before any voltages are extracted.
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
 * @param {boolean} params.isIntracranial - whether the recording is currently iEEG;
 *   passed through unchanged to both lifted snapshots.
 * @param {(snapshot: {isIntracranial: boolean, matched: Array, voltages: number[]}) => void} params.onElectrodeSnapshotChange
 *   Called whenever the electrode-matched voltage snapshot changes, so PatientView can
 *   rebuild the intracranial 3D connectome layer.
 * @param {(snapshot: {isIntracranial: boolean, channelNames: string[], voltages: number[]}) => void} params.onChannelSnapshotChange
 *   Called only when the user clicks a new topography timepoint, so PatientView/ESI can
 *   recompute source power from the full per-channel snapshot.
 * @returns {Object} The montaged buffer and derived voltage snapshots:
 *   - `montagedChannels` (Array|null) — `channels` with the selected montage applied, or
 *     `null` before `channels` is loaded.
 *   - `topoVoltages` (number[]) — one voltage per position-matched electrode at
 *     `topoTimepoint`, `[]` when there's nothing to show yet.
 *   - `topoVoltagesByChannel` (number[]) — one voltage per channel (not position-gated)
 *     at `topoTimepoint`, `[]` when there's nothing to show yet.
 */
export function useTopographySnapshot({
  channels,
  montage,
  topoTimepoint,
  timestamps,
  fs,
  matched,
  channelNames,
  isIntracranial,
  onElectrodeSnapshotChange,
  onChannelSnapshotChange,
}) {
  // Apply the selected montage once, shared by the channel plots and the topography snapshot
  const montagedChannels = useMemo(() => {
    if (!channels) return null;
    return applyMontage(channels, montage);
  }, [channels, montage]);

  // Sample index shared by both voltage snapshots below.
  const topoSampleIndex = useMemo(() => {
    if (topoTimepoint === null || !timestamps?.length) return null;
    return Math.max(
      0,
      Math.min(timestamps.length - 1, Math.round((topoTimepoint - timestamps[0]) * fs))
    );
  }, [topoTimepoint, timestamps, fs]);

  // Extract one voltage per matched channel at the clicked timepoint — drives the
  // scalp mesh and the intracranial 3D connectome (both need real x/y/z positions).
  const topoVoltages = useMemo(() => {
    if (topoSampleIndex === null || !montagedChannels || !matched.length) return [];
    return matched.map((m) => montagedChannels[m.channelIdx]?.[topoSampleIndex] ?? 0);
  }, [topoSampleIndex, montagedChannels, matched]);

  // Extract one voltage per channel (not just position-matched ones) at the same
  // timepoint — drives the intracranial matrix, which has no position-file gate.
  const topoVoltagesByChannel = useMemo(() => {
    if (topoSampleIndex === null || !montagedChannels) return [];
    return montagedChannels.map((ch) => ch?.[topoSampleIndex] ?? 0);
  }, [topoSampleIndex, montagedChannels]);

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
    if (topoTimepoint === null || !montagedChannels || !timestamps?.length) return;
    const sampleIndex = Math.max(
      0,
      Math.min(timestamps.length - 1, Math.round((topoTimepoint - timestamps[0]) * fs))
    );
    const voltages = montagedChannels.map((ch) => ch?.[sampleIndex] ?? 0);
    onChannelSnapshotChange?.({ isIntracranial, channelNames, voltages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topoTimepoint, isIntracranial, channelNames, onChannelSnapshotChange]);

  return { montagedChannels, topoVoltages, topoVoltagesByChannel };
}
