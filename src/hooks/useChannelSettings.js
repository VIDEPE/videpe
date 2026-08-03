import { useState, useEffect, useCallback } from 'react';

/**
 * Per-channel type ('eeg'|'seeg'|'other') and bad-channel flag, keyed by channel name.
 * Re-initializes whenever channelNames changes (new recording loaded), seeding new
 * channels from defaultType while preserving settings for channels that persist across
 * the change (e.g. the buffer window shifting shouldn't reset a channel the user already
 * flagged bad).
 *
 * @param {string[]} channelNames
 * @param {'eeg'|'seeg'|'other'} defaultType - seed type for newly-seen channels, normally
 *   the whole-recording isIntracranial detection from useElectrodeMatching.
 */
export function useChannelSettings(channelNames, defaultType = 'eeg') {
  const [channelSettings, setChannelSettings] = useState({});

  // Rebuilds channelSettings' keys to exactly match channelNames: carries over prior
  // settings via prev (so existing edits survive), seeds new channels with defaultType,
  // and drops channels no longer present. Reads prev instead of the closed-over
  // channelSettings so this doesn't need to be a dependency — avoiding a self-triggering loop.
  useEffect(() => {
    setChannelSettings((prev) => {
      const next = {};
      for (const name of channelNames) {
        next[name] = prev[name] ?? { type: defaultType, bad: false };
      }
      return next;
    });
  }, [channelNames, defaultType]);

  // useCallback([]) keeps these stable across renders for downstream props (EegMontageEditor).
  // Reading prev rather than closing over channelSettings avoids a stale closure, since with
  // an empty dependency array these functions are only ever created once.
  const setChannelType = useCallback((name, type) => {
    setChannelSettings((prev) => ({ ...prev, [name]: { ...prev[name], type } }));
  }, []);

  const setChannelBad = useCallback((name, bad) => {
    setChannelSettings((prev) => ({ ...prev, [name]: { ...prev[name], bad } }));
  }, []);

  return { channelSettings, setChannelType, setChannelBad };
}
