import { useState, useEffect, useCallback, useMemo } from 'react';

// Identifies which built-in montage template (if any) `rows` currently matches, so the
// sidebar's template <select> (see EegViewer.jsx) can reflect the live montage's actual
// state instead of drifting out of sync with it. 'none' = no rows (the display falls back
// to one row per non-bad channel with no reference, see buildMontageDisplayRows); 'average'
// = every channel has exactly one row referenced to 'average' (color is ignored —
// recoloring a CAR montage shouldn't demote it to Custom); anything else = null, i.e. a
// hand-built montage that doesn't match either preset.
function getMontageTemplateMatch(rows, channelNames) {
  if (rows.length === 0) return 'none';
  if (
    rows.length === channelNames.length &&
    channelNames.every((name) =>
      rows.some((row) => row.channel === name && row.reference === 'average')
    )
  )
    return 'average';
  return null;
}

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

  // ApplyMontageChannels = complete replace — commits a draft edited in EegMontageEditor (Apply/OK),
  // same pattern as useChannelSettings.applyChannelSettings.
  // Wrapped instead of exposing setMontageChannels directly, so logic can be added here later without changing EegMontageEditor's Apply/OK.
  const applyMontageChannels = useCallback((next) => {
    setMontageChannels(next);
  }, []);
  // (automatic housekeeping) When channelNames change (e.g. a new recording) it drops any montage rows
  // which no longer exists in channelNames (i.e. in the recording)
  // Note: it never adds rows for new channels, since row creation is always an explicit user action.
  useEffect(() => {
    setMontageChannels((prev) => prev.filter((row) => channelNames.includes(row.channel)));
  }, [channelNames]);

  // ─── Template dropdown (None / Common Average Reference / Custom) ─────────────
  const montageTemplate = useMemo(
    () => getMontageTemplateMatch(montageChannels, channelNames) ?? 'custom',
    [montageChannels, channelNames]
  );

  // State stores the last hand-built (non-preset) montage,
  // so it can be restored by selecting 'Custom' in the template dropdown in EegViewer.jsx.
  // Starts null (no custom montage set yet)
  const [customMontageChannels, setCustomMontageChannels] = useState(null);
  if (montageTemplate === 'custom' && customMontageChannels !== montageChannels) {
    setCustomMontageChannels(montageChannels);
  }

  const applyMontageTemplate = useCallback(
    (value) => {
      if (value === 'none') setMontageChannels([]);
      else if (value === 'average')
        setMontageChannels(
          channelNames.map((name) => ({
            id: crypto.randomUUID(),
            channel: name,
            reference: 'average',
            color: null,
          }))
        );
      else if (value === 'custom' && customMontageChannels)
        setMontageChannels(customMontageChannels);
    },
    [channelNames, customMontageChannels]
  );

  return {
    montageChannels,
    applyMontageChannels,
    montageTemplate,
    customMontageChannels,
    applyMontageTemplate,
  };
}
