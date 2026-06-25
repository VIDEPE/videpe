import { describe, it, expect, afterEach, vi } from 'vitest';
import { loadBrainVisionEEG } from '@/loaders/loadBrainVisionEEG';

// Minimal two-channel header at 200 Hz (SamplingInterval=5000 µs)
const VHDR = `; Created by test
[Common Infos]
NumberOfChannels=2
SamplingInterval=5000

[Binary Infos]
BinaryFormat=IEEE_FLOAT_32

[Channel Infos]
Ch1=Fp1,,1
Ch2=Fp2,,1
`;

const FS = 200; // 1_000_000 / SamplingInterval(5000)

// Round expected values to float32 precision, matching Float32Array storage
const f32 = (values) => Array.from(new Float32Array(values));

// MULTIPLEXED layout: [s0_ch0, s0_ch1, s1_ch0, s1_ch1, s2_ch0, s2_ch1]
// ch0 = [1, 2, 3], ch1 = [4, 5, 6]
function makeEegBuffer(values = [1, 4, 2, 5, 3, 6]) {
  const buf = new ArrayBuffer(values.length * 4);
  const view = new DataView(buf);
  values.forEach((v, i) => view.setFloat32(i * 4, v, true)); // little-endian
  return buf;
}

function mockFetch(vhdr = VHDR, buffer = makeEegBuffer()) {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(vhdr) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(buffer) })
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('loadBrainVisionEEG — header parsing', () => {
  it('returns the correct channel names', async () => {
    mockFetch();
    const { channelNames } = await loadBrainVisionEEG('h.vhdr', 'd.eeg');
    expect(channelNames).toEqual(['Fp1', 'Fp2']);
  });

  it('ignores comment lines starting with ;', async () => {
    mockFetch();
    const { channelNames } = await loadBrainVisionEEG('h.vhdr', 'd.eeg');
    expect(channelNames).toHaveLength(2);
  });

  it('throws when NumberOfChannels is absent', async () => {
    const bad = VHDR.replace('NumberOfChannels=2\n', '');
    mockFetch(bad);
    await expect(loadBrainVisionEEG('h.vhdr', 'd.eeg')).rejects.toThrow();
  });

  it('throws when SamplingInterval is absent', async () => {
    const bad = VHDR.replace('SamplingInterval=5000\n', '');
    mockFetch(bad);
    await expect(loadBrainVisionEEG('h.vhdr', 'd.eeg')).rejects.toThrow();
  });
});

describe('loadBrainVisionEEG — metadata', () => {
  it('returns fs derived from SamplingInterval', async () => {
    mockFetch();
    const { fs } = await loadBrainVisionEEG('h.vhdr', 'd.eeg');
    expect(fs).toBe(FS);
  });

  it('returns tMax = nSamples / fs, derived from the File size (File sources)', async () => {
    const headerFile = new File([VHDR], 'test.vhdr', { type: 'text/plain' });
    const dataFile = new File([makeEegBuffer()], 'test.eeg'); // 24 bytes, 2ch * 4 bytes = 3 samples
    const { tMax } = await loadBrainVisionEEG(headerFile, dataFile);
    expect(tMax).toBeCloseTo(3 / FS, 6);
  });

  it('returns tMax = nSamples / fs, derived from the fetched buffer size (URL sources)', async () => {
    mockFetch();
    const { tMax } = await loadBrainVisionEEG('h.vhdr', 'd.eeg');
    expect(tMax).toBeCloseTo(3 / FS, 6);
  });

  it('does not read the data file content for File sources before getChunk is called', async () => {
    const headerFile = new File([VHDR], 'test.vhdr', { type: 'text/plain' });
    const dataFile = new File([makeEegBuffer()], 'test.eeg');
    const arrayBufferSpy = vi.spyOn(dataFile, 'arrayBuffer');
    await loadBrainVisionEEG(headerFile, dataFile);
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });
});

describe('loadBrainVisionEEG — getChunk (File sources)', () => {
  const setup = (values) => {
    const headerFile = new File([VHDR], 'test.vhdr', { type: 'text/plain' });
    const dataFile = new File([makeEegBuffer(values)], 'test.eeg');
    return { headerFile, dataFile };
  };

  it('returns the full recording when requesting [0, tMax]', async () => {
    const { headerFile, dataFile } = setup();
    const provider = await loadBrainVisionEEG(headerFile, dataFile);
    const { timestamps, channels } = await provider.getChunk(0, provider.tMax);
    expect(Array.from(timestamps)).toEqual(f32([0, 1 / FS, 2 / FS]));
    expect(Array.from(channels[0])).toEqual([1, 2, 3]);
    expect(Array.from(channels[1])).toEqual([4, 5, 6]);
  });

  it('extracts a chunk starting mid-recording with absolute timestamps', async () => {
    const { headerFile, dataFile } = setup();
    const provider = await loadBrainVisionEEG(headerFile, dataFile);
    // Request samples 1..2 (skip sample 0)
    const { timestamps, channels } = await provider.getChunk(1 / FS, 3 / FS);
    expect(Array.from(timestamps)).toEqual(f32([1 / FS, 2 / FS]));
    expect(Array.from(channels[0])).toEqual([2, 3]);
    expect(Array.from(channels[1])).toEqual([5, 6]);
  });

  it('reads only the requested byte range via File.slice', async () => {
    const { headerFile, dataFile } = setup();
    const sliceSpy = vi.spyOn(dataFile, 'slice');
    const provider = await loadBrainVisionEEG(headerFile, dataFile);
    await provider.getChunk(1 / FS, 3 / FS);
    // sample 1..3, nChannels=2, 4 bytes/sample => stride 8 bytes/sample-time
    expect(sliceSpy).toHaveBeenCalledWith(8, 24);
  });

  it('clamps out-of-range requests to [0, tMax]', async () => {
    const { headerFile, dataFile } = setup();
    const provider = await loadBrainVisionEEG(headerFile, dataFile);
    const { timestamps, channels } = await provider.getChunk(-5, 1000);
    expect(Array.from(timestamps)).toEqual(f32([0, 1 / FS, 2 / FS]));
    expect(Array.from(channels[0])).toEqual([1, 2, 3]);
    expect(Array.from(channels[1])).toEqual([4, 5, 6]);
  });

  it('handles negative signal values', async () => {
    const { headerFile, dataFile } = setup([-1, -4, -2, -5, -3, -6]);
    const provider = await loadBrainVisionEEG(headerFile, dataFile);
    const { channels } = await provider.getChunk(0, provider.tMax);
    expect(Array.from(channels[0])).toEqual([-1, -2, -3]);
    expect(Array.from(channels[1])).toEqual([-4, -5, -6]);
  });
});

describe('loadBrainVisionEEG — getChunk (URL sources)', () => {
  it('demultiplexes the requested range correctly', async () => {
    mockFetch();
    const provider = await loadBrainVisionEEG('h.vhdr', 'd.eeg');
    const { timestamps, channels } = await provider.getChunk(1 / FS, 3 / FS);
    expect(Array.from(timestamps)).toEqual(f32([1 / FS, 2 / FS]));
    expect(Array.from(channels[0])).toEqual([2, 3]);
    expect(Array.from(channels[1])).toEqual([5, 6]);
  });

  it('serves chunks from a single cached fetch (no extra requests per getChunk call)', async () => {
    mockFetch();
    const provider = await loadBrainVisionEEG('h.vhdr', 'd.eeg');
    await provider.getChunk(0, 1 / FS);
    await provider.getChunk(1 / FS, 2 / FS);
    expect(fetch).toHaveBeenCalledTimes(2); // header + data, once each
  });
});

describe('loadBrainVisionEEG — fetch errors', () => {
  it('throws when the header request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, statusText: 'Not Found' }));
    await expect(loadBrainVisionEEG('missing.vhdr', 'd.eeg')).rejects.toThrow('Not Found');
  });

  it('throws when the data request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(VHDR) })
        .mockResolvedValueOnce({ ok: false, statusText: 'Not Found' })
    );
    await expect(loadBrainVisionEEG('h.vhdr', 'missing.eeg')).rejects.toThrow('Not Found');
  });
});
