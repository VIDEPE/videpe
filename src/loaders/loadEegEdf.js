import { createFrameBudget } from '@/utils/frameBudget';

// EDF File layout:
// ┌──────────────────────────────┐
// │ Fixed header      256 bytes  │  recording-wide info
// ├──────────────────────────────┤
// │ Signal headers  256 × ns     │  per-channel info (ns = number of signals)
// ├──────────────────────────────┤
// │ Data record 0                │
// │ Data record 1                │  binary samples, one block per record
// │ ...                          │
// └──────────────────────────────┘
//
// Three things that differ from BrainVision
// 1. Data is grouped per record, not interleaved sample by sample.
//    BrainVision stores [Fp1, Fp2, Cz, Fp1, Fp2, Cz, …], one time point after another.
//    EDF stores whole runs of one channel inside each record, so reading a time range means reading the records that cover it.
// 2. Samples are stored as integers, not microvolts.
//    Each value has to be converted using that channel's ranges: µV = stored × gain + offset,
//    where gain = (physMax − physMin) / (digMax − digMin).
//    The unit field can be uV, mV or V, so we also convert everything to µV.
// 3. Each channel can have its own sampling rate, through its own samplesPerRecord. => If that's the case it is rejected

const HEADER_SIZE = 256; // bytes
const BYTES_PER_SAMPLE = 2; // EDF uses int16 => 2 bytes per sample
// EDF+ stores events as text in a signal with this label => it is skipped for now until VIDEPE accepts annotations
const ANNOTATIONS_LABEL = 'EDF Annotations';

// Factor converting each voltage unit (lowercased) to µV, the unit VIDEPE plots in. Signals in
// any other unit (e.g. '%', 'bpm', or none) are not voltages and are kept in their own unit.
const MICROVOLTS_PER_UNIT = {
  nv: 1e-3,
  uv: 1,
  µv: 1, // micro sign (µ, as written in latin-1)
  μv: 1, // Greek mu (μ)
  mv: 1e3,
  v: 1e6,
};

// EDF headre has a fixed size (256 bytes) and is plain ASCII text
// each field has a fixed width and is padded with spaces
// - 8 bytes: version of this data format
// - 80 bytes: local patient identification
// - 80 bytes local recording identification.
// - 8 bytes: start date of recording (dd.mm.yy)
// - 8 bytes: start time of recording (hh.mm.ss)
// - 8 bytes: number of bytes in header record
// - 44 bytes: RESERVED. [blank] (plain EDF) / EDF+C (continuous) / EDF+D (discontinuous)
// - 8 bytes: number of records
// - 8 bytes: duration of a data recording in seconds
// - 4 bytes: number of signals (ns) in data record
const headerFields = [
  ['version', 8, 'string'],
  ['patientId', 80, 'string'],
  ['recordId', 80, 'string'],
  ['startDate', 8, 'string'],
  ['startTime', 8, 'string'],
  ['headerBytes', 8, 'number'],
  ['reserved', 44, 'string'],
  ['nRecords', 8, 'number'],
  ['recordDuration', 8, 'number'],
  ['ns', 4, 'number'],
];

// Signal headers
// labels:   [Fp1     ][Fp2     ][Cz      ]...   16 bytes each
// units:    [uV      ][uV      ][uV      ]...    8 bytes each
// physMin, physMax, digMin, digMax, ...
// samplesPerRecord: [256 ][256 ][256 ]...
const signalFields = [
  ['label', 16, 'string'],
  ['transducer', 80, 'string'],
  ['unit', 8, 'string'],
  ['physicalMin', 8, 'number'],
  ['physicalMax', 8, 'number'],
  ['digitalMin', 8, 'number'],
  ['digitalMax', 8, 'number'],
  ['prefiltering', 80, 'string'],
  ['samplesPerRecord', 8, 'number'],
  ['reserved', 32, 'string'],
];

// Header text is latin-1: one byte is always one character, so a character's index equals its byte offset
const latin1 = new TextDecoder('latin1');

// Reads bytes [start, end) of the file as text
async function readText(file, start, end) {
  const bytes = await file.slice(start, end).arrayBuffer();
  return latin1.decode(bytes);
}

// Converts a numeric header field — some writers use a decimal comma (e.g. '0,5'), as MNE also handles
const toNumber = (text) => Number(text.replace(',', '.'));

/**
 * Splits EDF header text into its fixed-width fields, one object per signal.
 *
 * EDF stores headers field by field, not signal by signal: for each field, the value of every
 * signal in turn (all labels, then all transducers, ...). The fixed header has the same layout
 * with a single "signal", so it's parsed with ns = 1.
 *
 * @param {string} text - the header bytes, decoded as latin-1 (so character index = byte offset).
 * @param {Array<[string, number]>} fields - [fieldName, width in bytes] pairs, in file
 *   order (e.g. headerFields or signalFields).
 * @param {number} [ns=1] - number of signals the text holds.
 * @returns {Object[]} one object per signal, mapping each field name to its value with the space
 *   padding trimmed, e.g. [{ label: 'Fp1', unit: 'uV', ... }, { label: 'Fp2', ... }]. Values
 *   are strings — numeric fields still need converting.
 */
function parseEdfHeader(text, fields, ns = 1) {
  // preallocate header: an array with length ns and each entry is an empty object
  const header = [];
  for (let i = 0; i < ns; i++) header.push({});

  let iByte = 0;
  // loop over the fieldnames
  for (const [fieldName, fieldLength, fieldType] of fields) {
    // loop over the signals, extract the text value and move iByte by fieldLength
    for (let iSignal = 0; iSignal < ns; iSignal++) {
      const value = text.slice(iByte, iByte + fieldLength);

      let cleanedValue = null;
      if (fieldType === 'number') {
        cleanedValue = toNumber(value.trim());
      } else if (fieldType === 'string') {
        cleanedValue = value.trim();
      } else {
        throw new Error(`fields value is either 'number' or 'string', not ${fieldType}`);
      }

      header[iSignal][fieldName] = cleanedValue;
      iByte += fieldLength;
    }
  }
  return header;
}

// Gain and offset that turn a stored integer into its physical value in µV (or in its own unit,
// for non-voltage signals): physical = stored × gain + offset.
// Same calibration as MNE: cal = physical range / digital range, offset = physicalMin − digitalMin × cal.
// i.e. how many uV is one step of the stored number
function computeScale({ physicalMin, physicalMax, digitalMin, digitalMax, unit }) {
  // a zero or unreadable range would divide by zero (or give NaN) — like MNE, use 1 instead
  const validRange = (range) => (Number.isFinite(range) && range !== 0 ? range : 1);
  const cal = validRange(physicalMax - physicalMin) / validRange(digitalMax - digitalMin);
  const offset = physicalMin - digitalMin * cal;
  const unitFactor = MICROVOLTS_PER_UNIT[unit.toLowerCase()] ?? 1; // unknown unit: keep as-is
  return { gain: cal * unitFactor, offset: offset * unitFactor };
}

async function demuxBuffer(
  buffer,
  signals,
  scales,
  nRecordsRead,
  firstRecord,
  samplesPerRecord,
  fs,
  abortSignal
) {
  const int16Buffer = new Int16Array(buffer); // the stored values, 2 bytes each
  const nChunkSamples = nRecordsRead * samplesPerRecord; // samples per channel in this chunk

  // Absolute timestamps: the chunk starts at the first sample of its first record
  const firstSample = firstRecord * samplesPerRecord;
  const timestamps = new Float32Array(nChunkSamples);
  for (let iSample = 0; iSample < nChunkSamples; iSample++)
    timestamps[iSample] = (firstSample + iSample) / fs;

  // Allocate separate arrays for each data channeln (i.e. without annotation)
  const nDataChannels = signals.filter((s) => s.label !== ANNOTATIONS_LABEL).length;
  const channels = Array.from({ length: nDataChannels }, () => new Float32Array(nChunkSamples));

  // initialise frame budget that allows for UI update pauses while loading the buffer
  const pauseIfOverBudget = createFrameBudget();

  let iSample = 0; // position in int16Buffer — walks through the buffer in file order
  // Walk through each record's signals in file order, so every value is read sequentially
  for (let iRecord = 0; iRecord < nRecordsRead; iRecord++) {
    let iChannel = 0; // output channel - only counts data channels
    for (const signal of signals) {
      if (signal.label !== ANNOTATIONS_LABEL) {
        // a data channel: its samplesPerRecord equals the shared one (checked at load time),
        // so convert its samples for this record to µV and write them to their place in the output
        const { gain, offset } = scales[iChannel];
        const output = channels[iChannel];
        const outputStart = iRecord * samplesPerRecord;
        for (let i = 0; i < samplesPerRecord; i++) {
          output[outputStart + i] = int16Buffer[iSample + i] * gain + offset;
        }
        iChannel++;
      }

      // step over this signal in the buffer — annotations can have their own samplesPerRecord,
      // so use the signal's own count (annotations are stepped over like this as nothing is copied)
      iSample += signal.samplesPerRecord;
    }

    // after each record (and only if there are records left):
    // pause if this burst has used up its time budget
    if (iRecord + 1 < nRecordsRead) await pauseIfOverBudget(abortSignal);
  }

  return { timestamps, channels };
}

// Data records
// record 0: [Fp1 × 256][Fp2 × 256][Cz × 256]
// record 1: [Fp1 × 256][Fp2 × 256][Cz × 256]

// TODO: have toast reject EDF+D (discontinuous edf), where records are not necessarily back to back in time

/**
 * Loads an EDF recording's metadata and returns a chunk-loading provider. Takes a File only —
 * demo recordings are fetched and wrapped as Files by useDemoData first.
 *
 * `tMax` is derived from the file's byte size (`File.size`) without reading its content.
 *
 * @param {File} file - the .edf file.
 * @returns {Promise<{
 *   channelNames: string[],
 *   fs: number,
 *   tMax: number,
 *   getChunk: (startTime: number, endTime: number, signal?: AbortSignal) =>
 *     Promise<{ timestamps: Float32Array, channels: Float32Array[] }>
 * }>} the provider:
 *   - `channelNames`: channel labels in file order.
 *   - `fs`: sampling frequency in Hz.
 *   - `tMax`: total recording duration in seconds.
 *   - `getChunk(startTime, endTime, signal)`: loads one time range (in seconds, clamped to
 *     [0, tMax]). Returns the whole records covering that range, so the result can start and
 *     end up to one record outside it — callers locate samples through `timestamps`, not the
 *     requested range. Resolves to `channels[i]`, the samples of channel i, and `timestamps`,
 *     absolute times in seconds (so `timestamps[0]` is the chunk's real start time: the start
 *     of its first record). The optional `signal` (from an AbortController) cancels the
 *     request: once aborted, getChunk stops at its next check and rejects with an AbortError.
 *
 *     Limitation: with very long records (e.g. a single record for the whole recording), every
 *     chunk is the whole file, which bypasses useEegBuffer's MAX_BUFFER_BYTES cap. Typical EDF
 *     records are 1 s, where the extra is negligible.
 * @throws {Error} when the header lacks NumberOfChannels/SamplingInterval, or a URL fetch fails.
 */
export async function loadEegEdf(file) {
  // file size guard to contain at least a header and 1 signal section (each HEADER_SIZE long)
  if (file.size < 2 * HEADER_SIZE) {
    throw new Error('EDF: file size too small to be a valid .edf');
  }

  // fixed header: recording-wide fields, always 256 bytes
  const headerText = await readText(file, 0, HEADER_SIZE);
  const header = parseEdfHeader(headerText, headerFields)[0]; // destructure header as it only contains 1 element
  const nChannels = header.ns;
  if (!(nChannels > 0)) {
    throw new Error('EDF: could not parse channel count');
  }
  // header.nRecords can be unreliable can be -1 if it's unknown, more reliable to calculate
  const headerBytes = HEADER_SIZE + nChannels * HEADER_SIZE; // nr of bytes in the headers (=eader+signal)
  if (header.headerBytes !== headerBytes)
    throw new Error('EDF: invalid header (header size does not match the number of signals)');
  if (file.size < headerBytes) throw new Error('EDF: file is too small to hold its header');

  // signal headers: 256 bytes per signal, so the size depends on nChannels (header.ns)
  const signalText = await readText(file, HEADER_SIZE, headerBytes);
  const signals = parseEdfHeader(signalText, signalFields, nChannels);

  // drop the annotation channel as VIDEPE can't use it now
  const dataSignals = signals.filter((s) => s.label !== ANNOTATIONS_LABEL);
  if (dataSignals.length === 0) throw new Error('EDF: the file holds no signal channels');

  // Like MNE: a record duration of 0 is treated as 1 s — and so is an unreadable (NaN) or
  // negative one, which would otherwise make fs and tMax meaningless
  const recordDuration = header.recordDuration > 0 ? header.recordDuration : 1;

  // The provider has a single fs, so all data channels must share one sampling rate
  // => throw error if they don't
  if (signals.some((s) => !(s.samplesPerRecord > 0)))
    throw new Error('EDF: invalid samples per record');
  const rates = new Set(dataSignals.map((s) => s.samplesPerRecord));
  if (rates.size > 1) {
    const ratesHz = [...rates].map((rate) => `${rate / recordDuration} Hz`).join(', ');
    throw new Error(
      `EDF: channels have different sampling rates (${ratesHz}), which VIDEPE doesn't support yet`
    );
  }
  const [samplesPerRecord] = rates; // the single rate left after the check above
  const fs = samplesPerRecord / recordDuration; // sampling frequency (Hz)

  const channelNames = dataSignals.map((s) => s.label);
  // gain and offset per data channel, to convert stored integers to µV — computed once per file,
  // not per chunk
  const scales = dataSignals.map((signal) => computeScale(signal));

  // sum all samplesPerRecord for all signals and multiple by BYTES_PER_SAMPLE (because int16)
  // important to include annotations (=> use signals not dataSignals) as they are still in the file
  const recordBytes = signals.reduce((sum, s) => sum + s.samplesPerRecord, 0) * BYTES_PER_SAMPLE;

  const dataByteLength = file.size - headerBytes; // number of bytes only the data portion has (including the )

  const nRecords = Math.floor(dataByteLength / recordBytes);
  const nSamples = nRecords * samplesPerRecord;
  const tMax = nRecords * recordDuration;

  // getChunk is the core of this loader:
  // it maps a requested time range to a byte range, reads that chunk of data.
  // The returned timestamps are absolute (not relative to the chunk) so they can be compared across chunks.
  const getChunk = async (startTime, endTime, abortSignal) => {
    abortSignal?.throwIfAborted(); // already cancelled before it started

    // Clamp requested times to recording duration, convert to sample indices, then byte offsets.
    const clampedStart = Math.max(0, Math.min(startTime, tMax));
    const clampedEnd = Math.max(0, Math.min(endTime, tMax));
    const startSample = Math.floor(clampedStart * fs);
    const endSample = Math.min(nSamples, Math.ceil(clampedEnd * fs));

    // Get which records are needed for the buffer slice
    const firstRecord = Math.floor(startSample / samplesPerRecord);
    const endRecord = Math.ceil(endSample / samplesPerRecord);
    const nRecordsRead = endRecord - firstRecord;

    // Get byte start and end points for the buffer slice
    const byteStart = headerBytes + firstRecord * recordBytes;
    const byteEnd = headerBytes + endRecord * recordBytes;

    // Read only the whole records covering the requested range from disk via File.slice (async)
    const buffer = await file.slice(byteStart, byteEnd).arrayBuffer();
    abortSignal?.throwIfAborted(); // cancelled while the file was being read

    // Demux channel records into separate channel arrays.
    // output: one array per data channel, plus absolute timestamps
    return demuxBuffer(
      buffer,
      signals,
      scales,
      nRecordsRead,
      firstRecord,
      samplesPerRecord,
      fs,
      abortSignal
    );
  };

  return { channelNames, fs, tMax, getChunk };
}
