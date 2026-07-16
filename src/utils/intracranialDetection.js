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
// the same as "B1" — but unlike normalizeChannelName, which only returns a cleaned-up
// string for exact-match lookups, this splits that string into its group ('B') and contact
// number ('1'), since the matrix view and connectome edges need those as separate values.
// Returns null for names that don't fit (e.g. "ECG", "Status", "12").
export function parseElectrodeContactName(name) {
  const match = normalizeChannelName(name).match(CONTACT_NAME_PATTERN);
  if (!match) return null;
  return { group: match[1], contact: parseInt(match[2], 10) };
}

// No implanted depth/strip/grid electrode carries more contacts than this under a single
// group letter — depth electrodes top out around 18, strips around 12, and even a large
// 8x8 ECoG grid is 64. A group larger than that is a scalp system's sequential channel
// numbering (e.g. EGI's E1-E208), not a real electrode.
const MAX_PLAUSIBLE_CONTACTS_PER_GROUP = 64;

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

  // Neither ratio clears its threshold, so this doesn't look like iEEG regardless of
  // group sizes — no need to check further.
  if (electrodeContactShapeRatio < 0.8 || standard1005MatchRatio >= 0.3) return false;

  // When the ratios above lean toward iEEG, also count the group sizes.
  // If a single letter-number group has more than MAX_PLAUSIBLE_CONTACTS_PER_GROUP (default 64)
  // then it is likely a surface EEG recording as iEEG electrodes typically don't have that many contacts.
  const groupSizes = new Map();
  for (const p of parsed) {
    if (!p) continue;
    groupSizes.set(p.group, (groupSizes.get(p.group) ?? 0) + 1);
  }
  const maxGroupSize = Math.max(...groupSizes.values());

  return maxGroupSize <= MAX_PLAUSIBLE_CONTACTS_PER_GROUP;
}
