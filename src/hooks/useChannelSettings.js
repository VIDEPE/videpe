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

  // Rebuilds channelSettings to match channelNames, and re-applies defaultType to every
  // channel whenever it changes (e.g. async isIntracranial detection settling, or the
  // manual EEG/iEEG toggle). bad is preserved from prev — unlike type, it has no "default"
  // to resync to, so it shouldn't be reset just because defaultType changed.
  useEffect(() => {
    setChannelSettings((prev) => {
      const next = {};
      for (const name of channelNames) {
        next[name] = { type: defaultType, bad: prev[name]?.bad ?? false };
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
