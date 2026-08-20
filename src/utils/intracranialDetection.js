// Heuristic detection of intracranial (sEEG/ECoG) recordings from channel naming,
// as opposed to scalp EEG. See the implementation plan for the full rationale.

import { matchChannelsToPositions } from './eegTopographyUtils';

// Matches a channel name (prefix/suffix already stripped, original case kept) shaped like an
// electrode-contact label: one-or-more letters of either case, an optional trailing apostrophe
// (stereo-EEG "primed" group notation), then digits. e.g. "B1", "t12", "b'7". Pure-digit names
// ("12") don't match — there's no leading letter group to anchor on.
const CONTACT_NAME_PATTERN = /^([a-zA-Z]+'?)(\d+)$/;

// Parses a channel name into its electrode group and contact number, if it has that shape.
// Strips the same "EEG "/"MEG " prefix and "-suffix" normalizeChannelName does (so "EEG B1-Ref"
// parses the same as "B1"), but keeps the original case so `groupLabel` displays as the
// recording actually spells it (e.g. "E", not "e") — `group` is the lowercased version of the
// same substring, used as a case-insensitive grouping/lookup key elsewhere (matrix rows,
// connectome edges), so "b1" and "B2" of the same physical probe still merge into one group even
// if a recording's casing is inconsistent. Returns null for names that don't fit (e.g. "ECG").
export function parseElectrodeContactName(name) {
  const stripped = name.replace(/^(eeg|meg)\s+/i, '').replace(/-.*$/, '');
  const match = stripped.match(CONTACT_NAME_PATTERN);
  if (!match) return null;
  return { group: match[1].toLowerCase(), groupLabel: match[1], contact: parseInt(match[2], 10) };
}

// No implanted depth/strip/grid electrode carries more contacts than this under a single
// group letter — depth electrodes top out around 18, strips around 12, and even a large
// 8x8 ECoG grid is 64. A group larger than that is a scalp system's sequential channel
// numbering (e.g. EGI's E1-E208), not a real electrode.
const MAX_PLAUSIBLE_CONTACTS_PER_GROUP = 64;

// Heuristic intracranial detector — see the implementation plan for the full
// rationale behind electrodeContactShapeRatio vs. fsaverage1005MatchRatio.
export function detectIsIntracranial(channelNames, fsaverage1005Electrodes) {
  if (!channelNames || channelNames.length === 0) return false;

  const parsed = channelNames.map(parseElectrodeContactName);
  const hasPrimedGroup = parsed.some((p) => p?.group.includes("'"));
  if (hasPrimedGroup) return true;

  const electrodeContactShapeRatio = parsed.filter(Boolean).length / channelNames.length;
  const fsaverage1005MatchRatio =
    matchChannelsToPositions(channelNames, fsaverage1005Electrodes).matched.length /
    channelNames.length;

  // Neither ratio clears its threshold, so this doesn't look like an intracranial recording
  // regardless of group sizes — no need to check further.
  if (electrodeContactShapeRatio < 0.8 || fsaverage1005MatchRatio >= 0.3) return false;

  // When the ratios above lean toward intracranial, also count the group sizes.
  // If a single letter-number group has more than MAX_PLAUSIBLE_CONTACTS_PER_GROUP (default 64)
  // then it is likely a surface EEG recording, as intracranial electrodes typically don't
  // have that many contacts.
  const groupSizes = new Map();
  for (const p of parsed) {
    if (!p) continue;
    groupSizes.set(p.group, (groupSizes.get(p.group) ?? 0) + 1);
  }
  const maxGroupSize = Math.max(...groupSizes.values());

  return maxGroupSize <= MAX_PLAUSIBLE_CONTACTS_PER_GROUP;
}
