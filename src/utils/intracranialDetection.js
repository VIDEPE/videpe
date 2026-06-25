// Heuristic detection of intracranial (sEEG/ECoG) recordings from channel naming,
// as opposed to scalp EEG. See the implementation plan for the full rationale.

import { normalizeChannelName, matchChannelsToPositions } from './eegTopographyUtils';

// Matches a normalized channel name shaped like an electrode-contact label:
// one-or-more letters, an optional trailing apostrophe (stereo-EEG "primed" group
// notation), then digits. e.g. "b1", "t12", "b'7". Pure-digit names ("12") don't
// match — there's no leading letter group to anchor on.
const CONTACT_NAME_PATTERN = /^([a-z]+'?)(\d+)$/;

// Parses a channel name into its electrode group and contact number, if it has that
// shape. Reuses normalizeChannelName's prefix/suffix stripping so "EEG B1-Ref" parses
// the same as "B1". Returns null for names that don't fit (e.g. "ECG", "Status", "12").
export function parseElectrodeContactName(name) {
  const match = normalizeChannelName(name).match(CONTACT_NAME_PATTERN);
  if (!match) return null;
  return { group: match[1], contact: parseInt(match[2], 10) };
}

// Heuristic intracranial detector — see the implementation plan for the full
// rationale behind electrodeContactShapeRatio vs. standard1005MatchRatio.
export function detectIsIntracranial(channelNames, standard1005Electrodes) {
  if (!channelNames || channelNames.length === 0) return false;

  const parsed = channelNames.map(parseElectrodeContactName);
  const hasPrimedGroup = parsed.some((p) => p?.group.includes("'"));
  if (hasPrimedGroup) return true;

  const electrodeContactShapeRatio = parsed.filter(Boolean).length / channelNames.length;
  const standard1005MatchRatio =
    matchChannelsToPositions(channelNames, standard1005Electrodes).matched.length /
    channelNames.length;

  return electrodeContactShapeRatio >= 0.8 && standard1005MatchRatio < 0.3;
}
