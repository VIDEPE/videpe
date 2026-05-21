// BrainVision EEG files come in two parts: a text header (.vhdr) and a binary data file (.eeg).
async function readText(source) {
  if (source instanceof File) return source.text();
  const r = await fetch(source);
  if (!r.ok) throw new Error(`Failed to fetch ${source}: ${r.statusText}`);
  return r.text();
}

// Read a binary file as an ArrayBuffer, whether from a File object or a URL.
async function readArrayBuffer(source) {
  if (source instanceof File) return source.arrayBuffer();
  const r = await fetch(source);
  if (!r.ok) throw new Error(`Failed to fetch ${source}: ${r.statusText}`);
  return r.arrayBuffer();
}

function parseVhdr(text) {
  const channelNames = [];
  let nChannels = 0;
  let samplingInterval = 0;
  let section = '';

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    if (line.startsWith('[')) {
      section = line.slice(1, -1);
      continue;
    }

    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();

    if (section === 'Common Infos') {
      if (key === 'NumberOfChannels') nChannels = parseInt(value, 10);
      if (key === 'SamplingInterval') samplingInterval = parseInt(value, 10);
    }

    if (section === 'Channel Infos') {
      // Format: ChN=label,,resolution  — label is before the first comma
      channelNames.push(value.split(',')[0]);
    }
  }

  return { nChannels, samplingInterval, channelNames };
}

/**
 * Load a BrainVision recording.
 * `header` and `data` can each be a URL string or a File object,
 * so this function works for both demo (URL) and user-upload (File) cases.
 *
 * Returns { data, channelNames } where data[0] is timestamps and
 * data[i+1] is the float32 signal for channel i.
 */
export async function loadBrainVisionEEG(header, data) {
  const [headerText, buffer] = await Promise.all([readText(header), readArrayBuffer(data)]);

  const { nChannels, samplingInterval, channelNames } = parseVhdr(headerText);
  if (nChannels === 0 || samplingInterval === 0) {
    throw new Error('Could not parse channel count or sampling interval from header');
  }

  const fs = 1_000_000 / samplingInterval; // SamplingInterval is in microseconds
  const float32 = new Float32Array(buffer);
  const nSamples = Math.floor(float32.length / nChannels);

  const timestamps = new Float32Array(nSamples);
  for (let t = 0; t < nSamples; t++) timestamps[t] = t / fs;

  const channels = Array.from({ length: nChannels }, () => new Float32Array(nSamples));

  // MULTIPLEXED layout: [s0_ch0, s0_ch1, ..., s0_chN, s1_ch0, ...]
  // Inner loop over channels keeps sequential reads on float32 (cache-friendly)
  for (let t = 0; t < nSamples; t++) {
    const offset = t * nChannels;
    for (let ch = 0; ch < nChannels; ch++) {
      channels[ch][t] = float32[offset + ch];
    }
  }

  return {
    data: [timestamps, ...channels],
    channelNames,
  };
}
