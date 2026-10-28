import { createFrameBudget } from '@/utils/frameBudget';

// Micromed TRC File layout (header type 4, all numbers little-endian):
// ┌──────────────────────────────┐
// │ Fixed header                 │  recording-wide info + zone table
// ├──────────────────────────────┤
// │ Zones                        │  ORDER, LABCOD, NOTE, TRIGGER, ...
// │                              │  each one found through the zone table
// ├──────────────────────────────┤  ← dataStartOffset
// │ Sample 0: [ch0][ch1]…[chN-1] │
// │ Sample 1: [ch0][ch1]…[chN-1] │  binary samples, interleaved
// │ ...                          │
// └──────────────────────────────┘
//
// Micromed's official spec isn't public: offsets below follow python-neo's micromedrawio.py
//
// Fixed header (byte offset: type, field)
// - 64:  surname (22 chars), first name (20 chars)
// - 128: 3 × uint8 recording date: day, month, year − 1900
// - 131: 3 × uint8 recording time: hour, minute, second
// - 138: uint32 dataStartOffset — byte where the samples begin
// - 142: uint16 nChannels
// - 144: uint16 multiplexer — bytes per sample frame (nChannels × bytesPerSample)
// - 146: uint16 rateMin — base sampling rate (Hz)
// - 148: uint16 bytesPerSample — 1, 2 or 4
// - 175: uint8  headerType — must be 4 (older types 2 and 3 are not supported)
// - 176: zone table — 15 entries of 16 bytes: name (8 chars), position (uint32), length (uint32)
//        in this order: ORDER, LABCOD, NOTE, FLAGS, TRONCA, IMPED_B, IMPED_E, MONTAGE,
//        COMPRESS, AVERAGE, HISTORY, DVIDEO, EVENT A, EVENT B, TRIGGER
//
// Zones
// - ORDER:   nChannels × uint16 — for each stored channel (in data order), its electrode index in LABCOD
// - LABCOD:  128-byte electrode records, electrode i at position + i × 128
//            +0  uint8 status, +1 uint8 type
//            +2  positive input label (6 chars) — the channel name
//            +8  negative input (reference) label (6 chars)
//            +14 5 × int32: logicalMin, logicalMax, logicalGround, physicalMin, physicalMax
//            +34 int16 unit code: -1 nV, 0 µV, 1 mV, 2 V, 100 %, 101 bpm, 102 dimensionless
//            +36 prefilter settings (8 bytes)
//            +44 uint16 rateCoefficient — channel rate = rateMin × rateCoefficient
// - TRONCA:  pairs of uint32 marking cuts in the recording, ended by (0, 0)
// - NOTE:    uint32 sample + 40 chars text, per note
// - TRIGGER: uint32 sample + uint16 code, per trigger
// - EVENT A / EVENT B: uint32 label, start sample, stop sample, per event
//
// Things that differ from BrainVision and EDF
// 1. The header is binary, not text: fields sit at fixed byte offsets and are read with a DataView.
//    The variable-size parts (channel order, electrodes, notes, triggers) live in zones whose
//    position and length come from the zone table.
// 2. Samples are interleaved like BrainVision [Fp1, Fp2, Cz, Fp1, Fp2, Cz, …], one time point after another,
//    but stored as unsigned integers of bytesPerSample bytes (1, 2 or 4), in ORDER order.
//    Sample n of channel c is at dataStartOffset + (n × nChannels + c) × bytesPerSample.
// 3. Samples are stored as integers, not microvolts.
//    Each value has to be converted using its electrode's ranges: physical = (stored − logicalGround) × gain,
//    where gain = (physicalMax − physicalMin) / (logicalMax − logicalMin + 1) — note the + 1, unlike EDF.
//    The unit code can be nV, µV, mV or V, so we also convert everything to µV.
// 4. Each channel can have its own sampling rate, through its own rateCoefficient. => If that's the case it is rejected
// 5. TRONCA cuts mean sample / fs is no longer the real time after a cut (the same problem as EDF+D).

// ─── File layout ──────────────────────────────────────────────────────────────

const HEADER_SIZE = 416; // fixed fields (176 bytes) + zone fields (15 zone * 16 bytes) = 416

// The zones in the zone table, in file order
const ZONE_NAMES = [
  'ORDER',
  'LABCOD',
  'NOTE',
  'FLAGS',
  'TRONCA',
  'IMPED_B',
  'IMPED_E',
  'MONTAGE',
  'COMPRESS',
  'AVERAGE',
  'HISTORY',
  'DVIDEO',
  'EVENT A',
  'EVENT B',
  'TRIGGER',
];

// Fixed header fields from byte 138: [fieldName, width in bytes, fieldType], in file order (12 bytes in total)
const headerFields = [
  ['dataStartOffset', 4, 'uint32'], // byte where the samples begin
  ['nChannels', 2, 'uint16'],
  ['multiplexer', 2, 'uint16'], // bytes per sample frame (nChannels × bytesPerSample)
  ['rateMin', 2, 'uint16'], // base sampling rate (Hz)
  ['bytesPerSample', 2, 'uint16'], // 1, 2 or 4
];

// Each zone table entry: [fieldName, width in bytes, fieldType], in file order (16 bytes in total)
const zoneFields = [
  ['name', 8, 'string'], // space-padded, e.g. 'ORDER   '
  ['position', 4, 'uint32'], // byte offset of the zone in the file
  ['length', 4, 'uint32'], // byte length of the zone
];

const ELECTRODE_BYTES = 128; // byte length of each electrode record in the LABCOD zone

// Each LABCOD electrode record, from its first byte: [fieldName, width in bytes, fieldType], in file order.
// The calibration numbers are signed (int16/int32), unlike the header fields; the bytes after
// rateCoefficient (up to 128) aren't needed and are not read.
const electrodeFields = [
  ['status', 1, 'uint8'],
  ['type', 1, 'uint8'],
  ['label', 6, 'string'], // positive input, the channel name
  ['reference', 6, 'string'], // negative input
  ['logicalMin', 4, 'int32'],
  ['logicalMax', 4, 'int32'],
  ['logicalGround', 4, 'int32'],
  ['physicalMin', 4, 'int32'],
  ['physicalMax', 4, 'int32'],
  ['unitCode', 2, 'int16'], // see MICROVOLTS_PER_UNIT_CODE
  ['prefiltering', 8, 'skip'], // high-pass/low-pass limits and types — not used
  ['rateCoefficient', 2, 'uint16'], // channel rate = rateMin × rateCoefficient
];

// ─── Sample decoding ──────────────────────────────────────────────────────────

// Factor converting each voltage unit code to µV, the unit VIDEPE plots in. Codes that aren't
// voltages (100 %, 101 bpm, 102 dimensionless) or unknown are kept in their own unit.
const MICROVOLTS_PER_UNIT_CODE = {
  '-1': 1e-3, // nV
  0: 1, // µV
  1: 1e3, // mV
  2: 1e6, // V
};

// Typed array that reads the stored samples, per bytesPerSample: TRC samples are unsigned integers.
// Typed arrays use the machine's byte order, which is little-endian on every browser platform —
// the same as TRC (BrainVision's loader relies on this too).
const SAMPLE_ARRAY_TYPES = { 1: Uint8Array, 2: Uint16Array, 4: Uint32Array };

// Time points between frame-budget checks (see createFrameBudget) — checking after every single
// one would waste time
const DEMUX_CLOCK_CHECK_INTERVAL = 1000;

// ─── Byte readers ─────────────────────────────────────────────────────────────

// Header text is latin-1: one byte is always one character
const latin1 = new TextDecoder('latin1');

// Reads bytes [start, end) of the file into a DataView
async function readAsDataView(file, start, end) {
  return new DataView(await file.slice(start, end).arrayBuffer());
}

// Decodes a fixed-width text field, trimming its null/space padding
function readText(view, offset, width) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, width);
  return latin1.decode(bytes).replace(/[\0\s]+$/, '');
}

// Decodes an integer of `width` bytes (1, 2 or 4), unsigned unless `signed` — TRC numbers are little-endian
function readNumber(view, offset, width, signed = false, littleEndian = true) {
  if (width === 1) return signed ? view.getInt8(offset) : view.getUint8(offset); // one byte: no byte order
  if (width === 2)
    return signed ? view.getInt16(offset, littleEndian) : view.getUint16(offset, littleEndian);
  if (width === 4)
    return signed ? view.getInt32(offset, littleEndian) : view.getUint32(offset, littleEndian);
  // only reachable through a mistake in the calls below, never through the file
  throw new Error(`TRC: unsupported number width ${width} (expected 1, 2 or 4 bytes)`);
}

// ─── Header parsing ───────────────────────────────────────────────────────────

async function parseTrcHeader(file, start, end) {
  const view = await readAsDataView(file, start, end);

  const header = {};

  const headerVersion = readNumber(view, 175, 1);
  if (headerVersion !== 4)
    throw new Error(
      `TRC: header version must be 4, header type ${headerVersion} is not implemented`
    );

  // fixed header fields: all unsigned numbers, so readNumber picks the getter from the width
  let iByte = 138;
  for (const [fieldName, fieldLength] of headerFields) {
    header[fieldName] = readNumber(view, iByte, fieldLength);
    iByte += fieldLength;
  }

  // zone table: one entry per zone, each read field by field into { name, position, length }
  iByte = 176;
  for (const zone of ZONE_NAMES) {
    header[zone] = {};
    for (const [fieldName, fieldLength, fieldType] of zoneFields) {
      if (fieldType === 'string') {
        header[zone][fieldName] = readText(view, iByte, fieldLength);
      } else if (fieldType === 'uint32') {
        header[zone][fieldName] = readNumber(view, iByte, fieldLength);
      } else {
        // only reachable through a mistake in zoneFields, never through the file
        throw new Error(`TRC: unknown field type '${fieldType}' (expected 'string' or 'uint32')`);
      }
      iByte += fieldLength;
    }
  }

  return header;
}

/**
 * Reads one electrode record from the LABCOD zone, field by field (see electrodeFields).
 *
 * @param {DataView} labcod - the whole LABCOD zone.
 * @param {number} electrodeIndex - the electrode's index in LABCOD (from the ORDER zone).
 * @returns {Object} each field name mapped to its value, e.g. { label: 'Fp1', logicalMin: 0, ... }.
 */
function parseTrcElectrode(labcod, electrodeIndex) {
  const electrode = {};
  let iByte = electrodeIndex * ELECTRODE_BYTES;
  for (const [fieldName, fieldLength, fieldType] of electrodeFields) {
    if (fieldType === 'string') {
      electrode[fieldName] = readText(labcod, iByte, fieldLength);
    } else if (fieldType.startsWith('uint') || fieldType.startsWith('int')) {
      // the width comes from fieldLength; 'int…' fields are signed
      electrode[fieldName] = readNumber(labcod, iByte, fieldLength, fieldType.startsWith('int'));
    } else if (fieldType !== 'skip') {
      // only reachable through a mistake in electrodeFields, never through the file
      throw new Error(`TRC: unknown field type '${fieldType}' in electrodeFields`);
    }
    iByte += fieldLength;
  }
  return electrode;
}

// ─── Samples: scaling and demuxing ────────────────────────────────────────────

// Gain and offset that turn a stored integer into its physical value in µV (or in its own unit,
// for non-voltage signals): physical = stored × gain + offset.
// Micromed calibration: gain = physical range / (logical range + 1), and the logical ground is
// the stored value of 0 µV, so offset = −logicalGround × gain.
// i.e. gain is how many µV one step of the stored number is
function computeScale({
  logicalMin,
  logicalMax,
  logicalGround,
  physicalMin,
  physicalMax,
  unitCode,
}) {
  // a zero range would divide by zero — use 1 instead
  const validRange = (range) => (Number.isFinite(range) && range !== 0 ? range : 1);

  const gain = validRange(physicalMax - physicalMin) / validRange(logicalMax - logicalMin + 1);
  const unitFactor = MICROVOLTS_PER_UNIT_CODE[unitCode] ?? 1; // not a voltage: keep as-is
  return { gain: gain * unitFactor, offset: -logicalGround * gain * unitFactor };
}

// Demultiplexes a range of interleaved samples: [s0_ch0, s0_ch1, ..., s0_chN, s1_ch0, ...] and
// converts each one to µV with its channel's scale.
// `sampleOffset` is the absolute sample index of stored[0], used to compute absolute timestamps
// so the returned timestamps[0] is the chunk's real start time (not 0).
//
// Runs in bursts, pausing between them (see createFrameBudget) so demuxing a large buffered
// chunk doesn't block the main thread in one shot.
// If `signal` is aborted during a pause, stops and throws an AbortError instead of finishing
// work whose result would be thrown away.
async function demuxTrc(stored, scales, nChannels, nSamples, sampleOffset, fs, signal) {
  const timestamps = new Float32Array(nSamples);
  // Compute absolute timestamps for each sample in the chunk based on the sample offset and sampling frequency.
  for (let t = 0; t < nSamples; t++) timestamps[t] = (sampleOffset + t) / fs;

  // Allocate separate arrays for each channel.
  const channels = Array.from({ length: nChannels }, () => new Float32Array(nSamples));

  // initialise frame budget that allows for UI update pauses while loading the buffer
  const pauseIfOverBudget = createFrameBudget();

  // Inner loop over channels keeps sequential reads on stored (cache-friendly)
  for (let t = 0; t < nSamples; t++) {
    const frameStart = t * nChannels;
    for (let ch = 0; ch < nChannels; ch++) {
      const { gain, offset } = scales[ch];
      channels[ch][t] = stored[frameStart + ch] * gain + offset;
    }

    // every DEMUX_CLOCK_CHECK_INTERVAL time points (and only if there's more to do):
    // pause if this burst has used up its time budget
    const isClockCheck = (t + 1) % DEMUX_CLOCK_CHECK_INTERVAL === 0 && t + 1 < nSamples;
    if (isClockCheck) await pauseIfOverBudget(signal);
  }

  return { timestamps, channels };
}

// ─── Loader ───────────────────────────────────────────────────────────────────

/**
 * Loads a TRC recording's metadata and returns a chunk-loading provider. Takes a File only —
 * demo recordings are fetched and wrapped as Files by useDemoData first.
 *
 * `tMax` is derived from the file's byte size (`File.size`) without reading the samples.
 *
 * @param {File} file - the .trc file.
 * @returns {Promise<{
 *   channelNames: string[],
 *   fs: number,
 *   tMax: number,
 *   getChunk: (startTime: number, endTime: number, signal?: AbortSignal) =>
 *     Promise<{ timestamps: Float32Array, channels: Float32Array[] }>
 * }>} the provider:
 *   - `channelNames`: channel labels in data order (the positive input of each electrode).
 *   - `fs`: sampling frequency in Hz.
 *   - `tMax`: total recording duration in seconds.
 *   - `getChunk(startTime, endTime, signal)`: loads one time range (in seconds, clamped to
 *     [0, tMax]). Resolves to `channels[i]`, the samples of channel i in µV (or in its own unit,
 *     for non-voltage signals), and `timestamps`, absolute times in seconds (so `timestamps[0]`
 *     is the chunk's real start time). The optional `signal` (from an AbortController) cancels
 *     the request: once aborted, getChunk stops at its next check and rejects with an AbortError.
 * @throws {Error} when the file isn't a valid header type 4 TRC (too small, or zones or data
 *   outside the file), holds no channels, has an unsupported number of bytes per sample, has
 *   cuts (TRONCA), or its channels have different sampling rates.
 */
export async function loadEegTrc(file) {
  // file size guard to contain at least the fixed header and the zone table
  if (file.size < HEADER_SIZE) {
    throw new Error('TRC: file size too small to be a valid .trc');
  }

  const header = await parseTrcHeader(file, 0, HEADER_SIZE);

  const nChannels = header.nChannels;
  if (!(nChannels > 0)) {
    throw new Error('TRC: the file holds no channels');
  }

  // the zones read below, and the start of the data, must lie inside the file
  const zonesRead = [header.ORDER, header.LABCOD, header.TRONCA];
  const fitsInFile = zonesRead.every((zone) => zone.position + zone.length <= file.size);
  if (!fitsInFile || header.dataStartOffset > file.size) {
    throw new Error('TRC: file is too small to hold its header');
  }

  // TRONCA lists cuts in the recording, a pair of zeros (0, 0) marks the end of cut list
  // VIDEPE assumes continuous data, so after a cut it would show the data on the wrong time axis.
  // => Reject it instead.
  // The pair 0,0 is uint32 so each is 4 bytes, 8 in total
  if (header.TRONCA.length >= 8) {
    const tronca = await readAsDataView(file, header.TRONCA.position, header.TRONCA.position + 8);
    if (readNumber(tronca, 0, 4) !== 0 || readNumber(tronca, 4, 4) !== 0) {
      throw new Error(
        "TRC: recordings with cuts (TRONCA) don't have a continuous time axis, which VIDEPE doesn't support yet"
      );
    }
  }

  // ORDER: for each stored channel (in data order), its electrode index in LABCOD
  const orderStart = header.ORDER.position;
  const order = await readAsDataView(file, orderStart, orderStart + nChannels * 2);
  const electrodeIndices = [];
  for (let i = 0; i < nChannels; i++) {
    electrodeIndices.push(readNumber(order, i * 2, 2));
  }

  // LABCOD: read the whole zone once, then pick each channel's electrode record from it
  const labcodStart = header.LABCOD.position;
  const labcod = await readAsDataView(file, labcodStart, labcodStart + header.LABCOD.length);
  const electrodes = electrodeIndices.map((index) => parseTrcElectrode(labcod, index));

  // The provider has a single fs, so all channels must share one sampling rate
  // => throw error if they don't
  const rates = new Set(electrodes.map((elec) => elec.rateCoefficient));
  if (rates.size > 1) {
    const MAX_LISTED_LABELS = 3; // keeps the toast short for recordings with many channels
    const ratesHz = [...rates]
      .map((rate) => {
        const labels = electrodes.filter((e) => e.rateCoefficient === rate).map((e) => e.label);
        const listed = labels.slice(0, MAX_LISTED_LABELS).join(', ');
        const more =
          labels.length > MAX_LISTED_LABELS ? ` +${labels.length - MAX_LISTED_LABELS} more` : '';
        return `${header.rateMin * rate} Hz: ${listed}${more}`;
      })
      .join('; ');
    throw new Error(
      `TRC: channels have different sampling rates (${ratesHz}), which VIDEPE doesn't support yet`
    );
  }

  const [rateCoefficient] = rates; // the single rate left after the check above
  const fs = header.rateMin * rateCoefficient; // sampling frequency (Hz)

  const channelNames = electrodes.map((elec) => elec.label);
  // gain and offset per channel, to convert stored integers to µV
  // computed once per file, not per chunk
  const scales = electrodes.map((electrode) => computeScale(electrode));

  // the typed array that reads the stored samples — throw if the width isn't 1, 2 or 4 bytes
  const SampleArray = SAMPLE_ARRAY_TYPES[header.bytesPerSample];
  if (!SampleArray) {
    throw new Error(
      `TRC: unsupported number of bytes per sample (${header.bytesPerSample}, expected 1, 2 or 4)`
    );
  }

  // one sample frame = one time point of all channels; samples run from dataStartOffset to the
  // end of the file — count the whole frames it actually holds (an incomplete last one is ignored)
  const frameBytes = nChannels * header.bytesPerSample;
  const nSamples = Math.floor((file.size - header.dataStartOffset) / frameBytes);
  const tMax = nSamples / fs;

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

    // Samples are interleaved, so a time range is one continuous byte range
    const byteStart = header.dataStartOffset + startSample * frameBytes;
    const byteEnd = header.dataStartOffset + endSample * frameBytes;

    // Read only the requested range from disk via File.slice (async)
    const buffer = await file.slice(byteStart, byteEnd).arrayBuffer();
    abortSignal?.throwIfAborted(); // cancelled while the file was being read

    // Demux the interleaved samples into separate channel arrays, converted to µV.
    // output: one array per channel, plus absolute timestamps
    return demuxTrc(
      new SampleArray(buffer),
      scales,
      nChannels,
      endSample - startSample,
      startSample,
      fs,
      abortSignal
    );
  };

  return { channelNames, fs, tMax, getChunk };
}
