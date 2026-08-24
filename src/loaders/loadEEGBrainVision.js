// BrainVision EEG files come in two parts: a text header (.vhdr) and a binary data file (.eeg).
// The .eeg file is raw, uncompressed, multiplexed IEEE_FLOAT_32 data (4 bytes per channel
// per sample-time), so an arbitrary time range maps directly to an arbitrary byte range —
// this lets loadBrainVisionEEG avoid reading the whole file for multi-hour recordings.
const BYTES_PER_SAMPLE = 4; // sizeof(IEEE_FLOAT_32); existing assumption, BinaryFormat is not parsed

async function readText(source) {
  if (source instanceof File) return source.text();
  const r = await fetch(source);
  if (!r.ok) throw new Error(`Failed to fetch ${source}: ${r.statusText}`);
  return r.text();
}

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
function demuxFloat32(float32, nChannels, nSamples, sampleOffset, fs) {
  const timestamps = new Float32Array(nSamples);
  // Compute absolute timestamps for each sample in the chunk based on the sample offset and sampling frequency.
  for (let t = 0; t < nSamples; t++) timestamps[t] = (sampleOffset + t) / fs;

  // Allocate separate arrays for each channel.
  const channels = Array.from({ length: nChannels }, () => new Float32Array(nSamples));
  // Inner loop over channels keeps sequential reads on float32 (cache-friendly)
  for (let t = 0; t < nSamples; t++) {
    const offset = t * nChannels;
    for (let ch = 0; ch < nChannels; ch++) {
      channels[ch][t] = float32[offset + ch];
    }
  }

  return { timestamps, channels };
}

/**
 * Load a BrainVision recording's metadata and return a chunk-loading provider.
 * `header` and `data` can each be a URL string or a File object, so this function
 * works for both demo (URL) and user-upload (File) cases.
 *
 * Returns `{ channelNames, fs, tMax, getChunk }`. `tMax` (total duration in seconds)
 * is derived from the data source's byte size without reading its content — for `File`
 * sources this is synchronous (`File.size`); for URL sources the data is fetched once
 * and cached (demo recordings are small, so an eager fetch is cheap).
 *
 * `getChunk(startTime, endTime)` resolves to `{ timestamps, channels }` for that time
 * range — `channels[i]` is the float32 signal for channel i, and `timestamps[0]` is the
 * chunk's absolute start time (so it can be a sub-range of the full recording).
 */
export async function loadBrainVisionEEG(header, data) {
  // extract header text from .vhdr file and parse it to get requirements for reading the binary file
  const headerText = await readText(header);
  const { nChannels, samplingInterval, channelNames } = parseVhdr(headerText);
  if (nChannels === 0 || samplingInterval === 0) {
    throw new Error('Could not parse channel count or sampling interval from header');
  }

  const fs = 1_000_000 / samplingInterval; // SamplingInterval is in microseconds
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
  // it maps a requested time range to a byte range, reads that chunk of data, and demuxes it into separate channel arrays.
  // The returned timestamps are absolute (not relative to the chunk) so they can be compared across chunks.
  const getChunk = async (startTime, endTime) => {
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

    // Demux the multiplexed float32 samples into separate channel arrays.
    const float32 = new Float32Array(buffer);
    return demuxFloat32(float32, nChannels, endSample - startSample, startSample, fs);
  };

  return { channelNames, fs, tMax, getChunk };
}
