import { parseAnyWaveMontage } from './parseMontageAnywave';
import { parseCartoolMontage } from './parseMontageCartool';

/**
 * Reads a montage file — from a File (the montage editor's Load button, from its hidden
 * file input) or a path/URL string (a built-in template fetched from
 * public/montage_files/) — and dispatches to the right parser by sniffing content, not
 * extension — both AnyWave (XML) and Cartool (plain text) montage files use the same .mtg
 * extension, so extension-based dispatch (like parseElectrodePositionFile.js uses) can't
 * tell them apart.
 *
 * @param {File|string} source
 * @returns {Promise<Object>} The parsed montage:
 *   - `rows` (Array<{channel, reference, color}>) — one entry per montage row, ready to
 *     seed EegMontageEditor's draft montage-row list. `reference` is `null` for a
 *     referential row, or another channel's name for a bipolar row. `color` is `null`
 *     when the file didn't specify one (renders with the theme default).
 *   - `channelTypes` (Record<channelName, 'eeg'|'seeg'|'other'>) — per-channel type
 *     overrides to apply to the channel-selection pane's draft. Empty (`{}`) for Cartool
 *     files, which carry no type information.
 */
export async function parseMontageFile(source) {
  let text;
  if (source instanceof File) {
    text = await source.text();
  } else {
    text = await fetch(source).then((r) => r.text());
  }
  return text.trimStart().startsWith('<') ? parseAnyWaveMontage(text) : parseCartoolMontage(text);
}
