import { createFrameBudget } from '@/utils/frameBudget';

// BrainVision EEG files come in two parts: a text header (.vhdr) and a binary data file (.eeg).
// The .eeg file is raw, uncompressed, multiplexed IEEE_FLOAT_32 data (4 bytes per channel
// per sample-time), so an arbitrary time range maps directly to an arbitrary byte range —
// this lets loadEegBrainVision avoid reading the whole file for multi-hour recordings.
const BYTES_PER_SAMPLE = 4; // sizeof(IEEE_FLOAT_32); existing assumption, BinaryFormat is not parsed

// Time points between frame-budget checks (see createFrameBudget) — checking after every single
// one would waste time
const DEMUX_CLOCK_CHECK_INTERVAL = 1000;

function parseVhdr(text) {
  const channelNames = []; // ordered labels parsed from [Channel Infos], e.g. ['Fp1', 'Fp2', ...]
  let nChannels = 0; // NumberOfChannels from [Common Infos]
  let samplingInterval = 0; // SamplingInterval from [Common Infos], in microseconds
  let section = ''; // name of the current [Section] header being parsed, e.g. 'Common Infos'

  for (const raw of text.split('\n')) {
    // loop over lines, prep them and detect if they contain a section header
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    if (line.startsWith('[')) {
      section = line.slice(1, -1);
      continue;
    }

    // Split "key=value" lines on the first '=' — lines without one aren't key/value pairs, skip them.
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;
    // extract key and value from both sides of the equal sign
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();

    if (section === 'Common Infos') {
      if (key === 'NumberOfChannels') nChannels = parseInt(value, 10);
      if (key === 'SamplingInterval') samplingInterval = parseFloat(value);
    }

    if (section === 'Channel Infos') {
      // Format: ChN=label,,resolution  — label is before the first comma
      channelNames.push(value.split(',')[0]); // split at ',' and take firs telement
    }
  }

  return { nChannels, samplingInterval, channelNames };
}

// Demultiplexes a range of MULTIPLEXED float32 samples: [s0_ch0, s0_ch1, ..., s0_chN, s1_ch0, ...]
// `sampleOffset` is the absolute sample index of float32[0], used to compute absolute timestamps
// so the returned timestamps[0] is the chunk's real start time (not 0).
//
// Runs in bursts, pausing between them (see createFrameBudget) so demuxing a large buffered
// chunk doesn't block the main thread in one shot.
// If `signal` is aborted during a pause, stops and throws an AbortError instead of finishing
// work whose result would be thrown away.
async function demuxFloat32(float32, nChannels, nSamples, sampleOffset, fs, signal) {
  const timestamps = new Float32Array(nSamples);
  // Compute absolute timestamps for each sample in the chunk based on the sample offset and sampling frequency.
  for (let t = 0; t < nSamples; t++) timestamps[t] = (sampleOffset + t) / fs;

  // Allocate separate arrays for each channel.
  const channels = Array.from({ length: nChannels }, () => new Float32Array(nSamples));

  // initialise frame budget that allows for UI update pauses while loading the buffer
  const pauseIfOverBudget = createFrameBudget();

  // Inner loop over channels keeps sequential reads on float32 (cache-friendly)
  for (let t = 0; t < nSamples; t++) {
    const offset = t * nChannels;
    for (let ch = 0; ch < nChannels; ch++) {
      channels[ch][t] = float32[offset + ch];
    }

    // every DEMUX_CLOCK_CHECK_INTERVAL time points (and only if there's more to do):
    // pause if this burst has used up its time budget
    const isClockCheck = (t + 1) % DEMUX_CLOCK_CHECK_INTERVAL === 0 && t + 1 < nSamples;
    if (isClockCheck) await pauseIfOverBudget(signal);
  }

  return { timestamps, channels };
}

/**
 * Loads a BrainVision recording's metadata and returns a chunk-loading provider. Takes Files
 * only — demo recordings are fetched and wrapped as Files by useDemoData first.
 *
 * `tMax` is derived from the data file's byte size (`File.size`) without reading its content.
 *
 * @param {File} headerFile - the .vhdr header.
 * @param {File} dataFile - the .eeg binary data.
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
 * @throws {Error} when the header's NumberOfChannels or SamplingInterval is missing or not a
 *   positive number.
 */
export async function loadEegBrainVision(headerFile, dataFile) {
  // extract header text from .vhdr file and parse it to get requirements for reading the binary file
  const headerText = await headerFile.text();
  const { nChannels, samplingInterval, channelNames } = parseVhdr(headerText);
  // !(x > 0) also catches NaN, e.g. from an unreadable value like 'NumberOfChannels=two'
  if (!(nChannels > 0)) {
    throw new Error('BrainVision: could not parse NumberOfChannels from the header');
  }
  if (!(samplingInterval > 0)) {
    throw new Error('BrainVision: could not parse SamplingInterval from the header');
  }

  const fs = 1_000_000 / samplingInterval; // SamplingInterval is in microseconds
  const bytesPerSampleTime = nChannels * BYTES_PER_SAMPLE;

  // the file's size is available without reading its content
  const nSamples = Math.floor(dataFile.size / bytesPerSampleTime);
  const tMax = nSamples / fs;

  // getChunk is the core of this loader:
  // it maps a requested time range to a byte range, reads that chunk of data, and demuxes it into separate channel arrays.
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

    // Read only the requested byte range from disk via File.slice (async)
    const buffer = await dataFile.slice(byteStart, byteEnd).arrayBuffer();
    signal?.throwIfAborted(); // cancelled while the file was being read

    // Demux the multiplexed float32 samples into separate channel arrays.
    const float32 = new Float32Array(buffer);
    return demuxFloat32(float32, nChannels, endSample - startSample, startSample, fs, signal);
  };

  return { channelNames, fs, tMax, getChunk };
}
