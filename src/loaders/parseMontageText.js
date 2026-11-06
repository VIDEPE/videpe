import { parseAnyWaveMontage } from './parseMontageAnywave';
import { parseCartoolMontage } from './parseMontageCartool';

/**
 * Parses montage file text, dispatching to the right parser by sniffing content, not
 * extension — both AnyWave (XML) and Cartool (plain text) montage files use the same .mtg
 * extension, so extension-based dispatch (like parseElectrodePositionFile.js uses) can't
 * tell them apart. Takes text rather than a File, so it's synchronous: the bundled montage
 * templates (?raw imports, see useMontageTemplates) are parsed with it at module load, and
 * the montage editor's Load button reads its File first.
 *
 * @param {string} text
 * @returns {Object} The parsed montage:
 *   - `rows` (Array<{channel, reference, color}>) — one entry per montage row, ready to
 *     seed EegMontageEditor's draft montage-row list. `reference` is `null` for a
 *     referential row, or another channel's name for a bipolar row. `color` is `null`
 *     when the file didn't specify one (renders with the theme default).
 *   - `channelTypes` (Record<channelName, 'eeg'|'seeg'|'other'>) — per-channel type
 *     overrides to apply to the channel-selection pane's draft. Empty (`{}`) for Cartool
 *     files, which carry no type information.
 */
export function parseMontageText(text) {
  return text.trimStart().startsWith('<') ? parseAnyWaveMontage(text) : parseCartoolMontage(text);
}
