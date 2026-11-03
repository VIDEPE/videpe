import { useState, useCallback } from 'react';

// Builds a settings entry for every channel in channelNames, typed defaultType. bad is
// preserved from prev — unlike type, it has no "default" to resync to, so it shouldn't be
// reset just because defaultType changed.
const buildChannelSettings = (channelNames, defaultType, prev) => {
  const next = {};
  for (const name of channelNames) {
    next[name] = { type: defaultType, bad: prev[name]?.bad ?? false };
  }
  return next;
};

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
  const [channelSettings, setChannelSettings] = useState(() =>
    buildChannelSettings(channelNames, defaultType, {})
  );

  // Rebuilds channelSettings to match channelNames, and re-applies defaultType to every
  // channel whenever it changes (e.g. async isIntracranial detection settling).
  // Done during render (comparing against the previous inputs) rather than in an effect, so
  // there's never a render with settings for the old channel list or type.
  const [prevInputs, setPrevInputs] = useState({ channelNames, defaultType });
  if (channelNames !== prevInputs.channelNames || defaultType !== prevInputs.defaultType) {
    setPrevInputs({ channelNames, defaultType });
    setChannelSettings((prev) => buildChannelSettings(channelNames, defaultType, prev));
  }

  // Wholesale replace — commits a draft edited in EegMontageEditor (Apply/OK). All editing,
  // single-channel or bulk, happens on that draft so Cancel can discard it uniformly; this
  // hook only needs to accept the finished result, not expose per-field live setters.
  const applyChannelSettings = useCallback((next) => {
    setChannelSettings(next);
  }, []);

  return { channelSettings, applyChannelSettings };
}
