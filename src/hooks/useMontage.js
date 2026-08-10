import { useState, useEffect, useCallback } from 'react';

/**
 * The montage row list edited via EegMontageEditor's montage-settings pane: one entry per
 * displayed trace, `{ id, channel, reference, color }` — `reference` null = referential,
 * or another channel name = bipolar (channel - reference); `color` null = no override
 * (theme default). This is an array, not a `Record<channelName, ...>` like
 * useChannelSettings, because a montage row list needs to support zero, one, or several
 * derived rows per source channel (custom bipolar builds, imported AnyWave/Cartool files)
 * — a per-channel record can't represent that. Rows are never auto-created: the list starts
 * empty and only grows when EegMontageEditor's draft explicitly adds a row (via its
 * "+ Add selected" / "Add by type" controls) and that draft is committed.
 *
 * @param {string[]} channelNames
 */
export function useMontageChannels(channelNames) {
  const [montageChannels, setMontageChannels] = useState([]);

  // Drops rows for channels no longer present (e.g. a new recording loaded) — never adds
  // rows for new channels, since row creation is always an explicit user action.
  useEffect(() => {
    setMontageChannels((prev) => prev.filter((row) => channelNames.includes(row.channel)));
  }, [channelNames]);

  // Wholesale replace — commits a draft edited in EegMontageEditor (Apply/OK), same pattern
  // as useChannelSettings.applyChannelSettings.
  const applyMontageChannels = useCallback((next) => {
    setMontageChannels(next);
  }, []);

  return { montageChannels, applyMontageChannels };
}
