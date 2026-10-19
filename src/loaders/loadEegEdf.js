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
  ['version', 8],
  ['patientId', 80],
  ['recordId', 80],
  ['startDate', 8],
  ['startTime', 8],
  ['headerBytes', 8],
  ['reserved', 44],
  ['nRecords', 8],
  ['recordDuration', 8],
  ['ns', 4],
];

// Signal headers
// labels:   [Fp1     ][Fp2     ][Cz      ]...   16 bytes each
// units:    [uV      ][uV      ][uV      ]...    8 bytes each
// physMin, physMax, digMin, digMax, ...
// samplesPerRecord: [256 ][256 ][256 ]...

const signalFields = [
  ['label', 16],
  ['transducer', 80],
  ['unit', 8],
  ['physicalMin', 8],
  ['physicalMax', 8],
  ['digitalMin', 8],
  ['digitalMax', 8],
  ['prefiltering', 80],
  ['samplesPerRecord', 8],
  ['reserved', 32],
];

// Header text is latin-1: one byte is always one character, so a character's index equals its byte offset
const latin1 = new TextDecoder('latin1');

// Reads bytes [start, end) of the file as text
async function readText(file, start, end) {
  const bytes = await file.slice(start, end).arrayBuffer();
  return latin1.decode(bytes);
}

// Data records
// record 0: [Fp1 × 256][Fp2 × 256][Cz × 256]
// record 1: [Fp1 × 256][Fp2 × 256][Cz × 256]

// TODO: have toast reject EDF+D (discontinuous edf), where records are not necessarily back to back in time
// TODO: signal label 'EDF Annotations' holds events and should be skipped
// TODO: The header's record count is sometimes -1 or wrong. MNE counts the records from the file size instead

/**
 * Loads an EDF recording's metadata and returns a chunk-loading provider. Works for
 * both demo (URL) and user-upload (File) sources.
 *
 * `tMax` is derived from the data source's byte size without reading its content: for a
 * `File` that's synchronous (`File.size`); a URL's data is fetched once and cached (demo
 * recordings are small, so an eager fetch is cheap).
 *
 * @param {string|File} data - the .eeg binary data, as a URL or a File.
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
 *     [0, tMax]). Resolves to `channels[i]`, the samples of channel i, and `timestamps`,
 *     absolute times in seconds (so `timestamps[0]` is the chunk's real start time). The
 *     optional `signal` (from an AbortController) cancels the request: once aborted, getChunk
 *     stops at its next check and rejects with an AbortError.
 * @throws {Error} when the header lacks NumberOfChannels/SamplingInterval, or a URL fetch fails.
 */
export async function loadEegEdf(file) {
  // fixed header: recording-wide fields, always 256 bytes
  const headerText = await readText(file, 0, HEADER_SIZE);
  let header = {};
  let iByte = 0;
  let iField = 0;
  while (iField < headerFields.length) {
    const fieldName = headerFields[iField][0];
    const fieldLength = headerFields[iField][1];
    const text = headerText.slice(iByte, iByte + fieldLength);
    header[fieldName] = text.trim(); // trim padding from each field
    iField++;
    iByte += fieldLength;
  }

  // signal headers: 256 bytes per signal, so the size depends on ns
  const signalText = await readText(file, HEADER_SIZE, HEADER_SIZE + header.ns * HEADER_SIZE);

  if (nChannels === 0 || samplingInterval === 0) {
    throw new Error('Could not parse channel count or sampling interval from header');
  }

  const fs = signal.samplesPerRecord / header.ns; // sampling frequency (Hz)
  const bytesPerSampleTime = nChannels * BYTES_PER_SAMPLE;

  // For File sources, size is available without reading content. For URL sources,
  // eagerly fetch + cache the buffer once so subsequent getChunk calls are in-memory slices.
  let cachedBuffer = null;
  let dataByteLength;
  if (data instanceof File) {
    dataByteLength = data.size;
  } else {
    const r = await fetch(data);
    if (!r.ok) throw new Error(`Failed to fetch ${data}: ${r.statusText}`);
    cachedBuffer = await r.arrayBuffer();
    dataByteLength = cachedBuffer.byteLength;
  }

  const nSamples = Math.floor(dataByteLength / bytesPerSampleTime);
  const tMax = nSamples / fs;

  // getChunk is the core of this loader:
  // it maps a requested time range to a byte range, reads that chunk of data.
  // The returned timestamps are absolute (not relative to the chunk) so they can be compared across chunks.
  const getChunk = async (startTime, endTime, signal) => {
    signal?.throwIfAborted(); // already cancelled before it started
    // Clamp requested times to recording duration, convert to sample indices, then byte offsets.
    const clampedStart = Math.max(0, Math.min(startTime, tMax));
    const clampedEnd = Math.max(0, Math.min(endTime, tMax));
    const startSample = Math.floor(clampedStart * fs);
    const endSample = Math.min(nSamples, Math.ceil(clampedEnd * fs));

    const byteStart = startSample * bytesPerSampleTime;
    const byteEnd = endSample * bytesPerSampleTime;

    // URL source: slice the already-fetched ArrayBuffer in memory (sync).
    // File source: read only the requested byte range from disk via File.slice (async).
    const buffer =
      cachedBuffer !== null
        ? cachedBuffer.slice(byteStart, byteEnd)
        : await data.slice(byteStart, byteEnd).arrayBuffer();
    signal?.throwIfAborted(); // cancelled while the file was being read

    // Demux the multiplexed float32 samples into separate channel arrays.
    const float32 = new Float32Array(buffer);
    return demuxFloat32(float32, nChannels, endSample - startSample, startSample, fs, signal);
  };

  return { channelNames, fs, tMax, getChunk };
}
