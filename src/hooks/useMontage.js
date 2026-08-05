import { useState, useEffect, useCallback } from 'react';

/**
 * Owns the EEG reference montage — currently 'none' | 'average' | 'median', with room to
 * grow into more montage types (e.g. bipolar, laplacian) and bad-channel selection later.
 * Deliberately has no knowledge of any feature that depends on a particular montage (e.g.
 * Electrical Source Imaging, which requires 'average') — that dependency lives in the
 * feature's own hook, which takes `montage`/`setMontage` as inputs instead of this hook
 * reaching out to know about it.
 *
 * @returns {Object} The current montage state, plus the functions to drive it:
 *   - `montage` ('none'|'average'|'median') — the currently selected EEG reference montage.
 *   - `setMontage` (newMontage: string) => void — the raw state setter, for direct control
 *     by the caller (e.g. EegViewer's montage dropdown) or by dependent hooks/effects that
 *     need to change the montage on the user's behalf (e.g. forcing 'average' for ESI).
 *   - `resetMontage` () => void — resets the montage back to 'none'.
 */
export function useMontage() {
  // 'none' | 'average' | 'median'
  const [montage, setMontage] = useState('none');

  const resetMontage = useCallback(() => setMontage('none'), []);

  return { montage, setMontage, resetMontage };
}

/**
 * The montage row list edited via EegMontageEditor's montage-settings pane: one entry per
 * displayed trace, `{ id, channel, reference, color }` — `reference` null = referential,
 * or another channel name = bipolar (channel - reference); `color` null = no override
 * (theme default). This is an array, not a `Record<channelName, ...>` like
 * useChannelSettings, because a montage row list needs to support zero, one, or several
 * derived rows per source channel (custom bipolar builds, imported AnyWave/Cartool files)
 * — a per-channel record can't represent that. For now it's seeded 1:1 with channelNames
 * (one row per recording channel, the array's simplest case), so add/remove/reorder can be
 * layered on later without reshaping the state.
 *
 * @param {string[]} channelNames
 */
export function useMontageChannels(channelNames) {
  const [montageChannels, setMontageChannels] = useState([]);

  // Rebuilds montageChannels to match channelNames, preserving each surviving channel's
  // row (reference/color) — mirrors useChannelSettings' re-seed-but-preserve pattern.
  useEffect(() => {
    setMontageChannels((prev) => {
      const prevByChannel = new Map(prev.map((row) => [row.channel, row]));
      return channelNames.map(
        (name) =>
          prevByChannel.get(name) ?? { id: name, channel: name, reference: null, color: null }
      );
    });
  }, [channelNames]);

  // Wholesale replace — commits a draft edited in EegMontageEditor (Apply/OK), same pattern
  // as useChannelSettings.applyChannelSettings.
  const applyMontageChannels = useCallback((next) => {
    setMontageChannels(next);
  }, []);

  return { montageChannels, applyMontageChannels };
}
