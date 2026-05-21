import { loadBrainVisionEEG } from './loadBrainVisionEEG';

// This module defines supported EEG formats and provides a function to detect and load them.

const baseName = (filename) => filename.slice(0, filename.lastIndexOf('.'));

// EEG_FORMATS is an array of supported EEG formats. Each format has:
// - name: a human-readable name for the format
// - description: a list of the supported file types for this format
// - partialDetect(files): true if any of the format's files are present (used for accumulation UX)
// - validate(files): returns { complete, missing[], warning } — complete only when all files present and names match
// - load(files): loads the EEG data from the given files and returns { data, channelNames }
const EEG_FORMATS = [
  {
    name: 'BrainVision',
    description: '.vhdr + .eeg',
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
    // load assumes validation has passed and both .vhdr and .eeg files are present, finds them, and loads the data using loadBrainVisionEEG
    load: (files) => {
      const header = files.find((f) => f.name.toLowerCase().endsWith('.vhdr'));
      const data = files.find((f) => f.name.toLowerCase().endsWith('.eeg'));
      if (!header) throw new Error('BrainVision: missing .vhdr header file');
      if (!data) throw new Error('BrainVision: missing .eeg data file');
      return loadBrainVisionEEG(header, data);
    },
  },
  // Future EEG formats: add an entry here.
];

// Checks files against all known formats, including partial matches.
// Returns { formatName, complete, missing[], warning } — formatName is null if unrecognized.
export function checkEegFiles(files) {
  const format = EEG_FORMATS.find((f) => f.partialDetect(files));
  if (!format) return { formatName: null, complete: false, missing: null, warning: null };
  const { complete, missing, warning } = format.validate(files);
  return { formatName: format.name, complete, missing, warning };
}

export function detectAndLoadEEG(files) {
  // find the first format that has all required files present
  const format = EEG_FORMATS.find((f) => f.validate(files).complete);
  // if no format matches, throw an error listing the supported formats
  if (!format) {
    const supported = EEG_FORMATS.map((f) => `${f.name} (${f.description})`).join(', ');
    throw new Error(`Unrecognized EEG format. Supported: ${supported}`);
  }
  // if a format is found, use its load function to load the data
  return format.load(files);
}
