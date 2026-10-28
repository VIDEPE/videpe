import { loadEegBrainVision } from '@/loaders/loadEegBrainVision';
import { loadEegEdf } from '@/loaders/loadEegEdf';
import { loadEegTrc } from '@/loaders/loadEegTrc';

// This module defines supported EEG formats and provides a function to detect and load them.

// File extensions routed to their respective handlers in PatientView and EegViewer.
// Exported so both components share the same truth without duplicating the lists.
export const ELEC_POS_EXTENSIONS = ['.elc', '.tsv'];
export const INV_SOLUTIONS_EXTENSIONS = ['.mat'];

const baseName = (filename) => filename.slice(0, filename.lastIndexOf('.'));

// Builds the format entry for a recording stored in one file (e.g. .edf, .trc): the file's
// extension is the only thing that differs, so nothing has to be renamed per format
function singleFileFormat({ name, extension, load }) {
  const prefix = extension.slice(1).toUpperCase(); // '.trc' → 'TRC', for error messages
  const findFile = (files) => files.find((f) => f.name.toLowerCase().endsWith(extension));

  return {
    name,
    extensions: [extension],
    partialDetect: (files) => Boolean(findFile(files)),
    validate: (files) => {
      const missing = findFile(files) ? [] : [extension];
      const warning = null; // no relevant warning: a single file can't mismatch another one
      return { complete: missing.length === 0, missing, warning };
    },
    // load assumes validation has passed and the file is present, finds it, and loads it
    load: (files) => {
      const file = findFile(files);
      if (!file) throw new Error(`${prefix}: missing ${extension} data file`);
      return load(file);
    },
  };
}

// EEG_FORMATS is an array of supported EEG formats. Each format has:
// - name: a human-readable name for the format
// - extensions: file extensions recognized as belonging to this format
// - partialDetect(files): true if any of the format's files are present (used for accumulation UX)
// - validate(files): returns { complete, missing[], warning } — complete only when all files present and names match
// - load(files): loads the EEG data from the given files and returns a recording provider
//   { channelNames, fs, tMax, getChunk }
const EEG_FORMATS = [
  {
    name: 'BrainVision Core Data Format (BVCDF)',
    extensions: ['.vhdr', '.eeg'],
    partialDetect: (files) =>
      files.some((f) => {
        const name = f.name.toLowerCase();
        return name.endsWith('.vhdr') || name.endsWith('.eeg');
      }),
    validate: (files) => {
      const vhdr = files.find((f) => f.name.toLowerCase().endsWith('.vhdr'));
      const eeg = files.find((f) => f.name.toLowerCase().endsWith('.eeg'));
      const missing = [...(!vhdr ? ['.vhdr'] : []), ...(!eeg ? ['.eeg'] : [])];
      // When both files are present, warn if their base names differ — likely a recording mismatch
      const warning =
        vhdr && eeg && baseName(vhdr.name) !== baseName(eeg.name)
          ? `Name mismatch — header (.hdr) and data (.eeg) may belong to different recordings.\nDrop the correct matching file to replace.`
          : null;
      return { complete: missing.length === 0 && !warning, missing, warning };
    },
    // load assumes validation has passed and both .vhdr and .eeg files are present, finds them, and loads the data using loadEegBrainVision
    load: (files) => {
      const header = files.find((f) => f.name.toLowerCase().endsWith('.vhdr'));
      const data = files.find((f) => f.name.toLowerCase().endsWith('.eeg'));
      if (!header) throw new Error('BrainVision: missing .vhdr header file');
      if (!data) throw new Error('BrainVision: missing .eeg data file');
      return loadEegBrainVision(header, data);
    },
  },
  singleFileFormat({ name: 'European Data Format (EDF)', extension: '.edf', load: loadEegEdf }),
  singleFileFormat({ name: 'Micromed EEG Trace (TRC)', extension: '.trc', load: loadEegTrc }),
  // Future EEG formats: add an entry here.
];

// Extensions recognized by any supported EEG recording format — used to reject files
// that don't belong in the EEG panel at all (e.g. imaging volumes) before they're held
// as pending, rather than relying solely on partialDetect after the fact.
export const EEG_FORMAT_EXTENSIONS = EEG_FORMATS.flatMap((f) => f.extensions);

/**
 * Names the EEG format a file belongs to, by its extension — e.g. to tell whether files dropped
 * at different times can belong to the same recording.
 *
 * @param {string} fileName - e.g. 'sub01.vhdr' (case-insensitive).
 * @returns {string|null} the format's name, or null if no supported format uses that extension.
 */
export function getEegFormatName(fileName) {
  const name = fileName.toLowerCase();
  return EEG_FORMATS.find((f) => f.extensions.some((ext) => name.endsWith(ext)))?.name ?? null;
}

// Every supported EEG format's name and extensions, e.g. { name: 'BrainVision', extensions:
// ['.vhdr', '.eeg'] } — for telling the user what VIDEPE can load (dropzone, messages), so a new
// format above shows up there automatically.
export const SUPPORTED_EEG_FORMATS = EEG_FORMATS.map(({ name, extensions }) => ({
  name,
  extensions,
}));

// The same as one line of text, e.g. 'BrainVision (.vhdr + .eeg), …' — for error messages
export const SUPPORTED_EEG_FORMATS_TEXT = SUPPORTED_EEG_FORMATS.map(
  (f) => `${f.name} (${f.extensions.join(' + ')})`
).join(', ');

/**
 * Checks files against all known formats, including partial matches, so the EEG intake can
 * hold an incomplete set as pending and tell the user which files are still missing. The
 * first format whose partialDetect matches is validated; later formats are not tried.
 *
 * @param {File[]} files - the files dropped or accumulated so far.
 * @returns {{ formatName: string|null, complete: boolean, missing: string[]|null, warning: string|null }}
 *   formatName is null (and missing/warning are null) if no format recognizes any of the files.
 *   complete is true only when all required files are present and no warning was raised.
 *   missing lists the extensions still needed (e.g. ['.eeg']).
 *   warning describes a problem that blocks loading even when no files are missing (e.g. a base-name mismatch).
 */
export function checkEegFiles(files) {
  const format = EEG_FORMATS.find((f) => f.partialDetect(files));
  if (!format) return { formatName: null, complete: false, missing: null, warning: null };
  const { complete, missing, warning } = format.validate(files);
  return { formatName: format.name, complete, missing, warning };
}

/**
 * Loads an EEG recording with the first format whose validate() reports a complete file set.
 * Call checkEegFiles first if you need to tell the user what's missing; this function only
 * reports that no format matched.
 *
 * @param {File[]} files - the recording's files (e.g. a BrainVision .vhdr + .eeg pair).
 * @returns {Promise<{ channelNames: string[], fs: number, tMax: number, getChunk: Function }>}
 *   the recording provider returned by the matching format's load().
 * @throws {Error} synchronously if no format has a complete file set; the message lists the
 *   supported formats and their extensions.
 */
export function detectAndLoadEEG(files) {
  // find the first format that has all required files present
  const format = EEG_FORMATS.find((f) => f.validate(files).complete);
  // if no format matches, throw an error listing the supported formats
  if (!format) {
    throw new Error(`Unrecognized EEG format. Supported: ${SUPPORTED_EEG_FORMATS_TEXT}`);
  }
  // if a format is found, use its load function to load the data
  return format.load(files);
}
