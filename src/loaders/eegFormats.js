import { loadBrainVisionEEG } from './loadBrainVisionEEG';

// This module defines supported EEG formats and provides a function to detect and load them.

// EEG_Fomats is an array of supported EEG formats. Each format has:
// - name: a human-readable name for the format
// - description: a list of the supported file types for this format
// - detect(files): a function that checks if the given files match this format
// - load(files): a function that loads the EEG data from the given files and returns { data, channelNames }
const EEG_FORMATS = [
  {
    name: 'BrainVision',
    description: '.vhdr + .eeg',
    detect: (files) => files.some((f) => f.name.toLowerCase().endsWith('.vhdr')),
    load: (files) => {
      const header = files.find((f) => f.name.toLowerCase().endsWith('.vhdr'));
      const data   = files.find((f) => f.name.toLowerCase().endsWith('.eeg'));
      if (!header) throw new Error('BrainVision: missing .vhdr header file');
      if (!data)   throw new Error('BrainVision: missing .eeg data file');
      return loadBrainVisionEEG(header, data);
    },
  },
  // Future EEG formats: add an entry here.
];

export function detectAndLoadEEG(files) {
  const format = EEG_FORMATS.find((f) => f.detect(files));
  if (!format) {
    const supported = EEG_FORMATS.map((f) => `${f.name} (${f.description})`).join(', ');
    throw new Error(`Unrecognized EEG format. Supported: ${supported}`);
  }
  return format.load(files);
}
