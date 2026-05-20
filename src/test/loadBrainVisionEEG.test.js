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

// MULTIPLEXED layout: [s0_ch0, s0_ch1, s1_ch0, s1_ch1, s2_ch0, s2_ch1]
// ch0 = [1, 2, 3], ch1 = [4, 5, 6]
function makeEegBuffer(values = [1, 4, 2, 5, 3, 6]) {
  const buf = new ArrayBuffer(values.length * 4);
  const view = new DataView(buf);
  values.forEach((v, i) => view.setFloat32(i * 4, v, true)); // little-endian
  return buf;
}

function mockFetch(vhdr = VHDR, buffer = makeEegBuffer()) {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(vhdr) })
    .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(buffer) }),
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

describe('loadBrainVisionEEG — output shape', () => {
  it('data array length equals number of channels + 1 (timestamps)', async () => {
    mockFetch();
    const { data, channelNames } = await loadBrainVisionEEG('h.vhdr', 'd.eeg');
    expect(data).toHaveLength(channelNames.length + 1);
  });

  it('each array has the correct number of samples', async () => {
    mockFetch();
    const { data } = await loadBrainVisionEEG('h.vhdr', 'd.eeg');
    // 6 float32 values / 2 channels = 3 samples
    data.forEach((arr) => expect(arr).toHaveLength(3));
  });
});

describe('loadBrainVisionEEG — timestamps', () => {
  it('first timestamp is 0', async () => {
    mockFetch();
    const { data } = await loadBrainVisionEEG('h.vhdr', 'd.eeg');
    expect(data[0][0]).toBe(0);
  });

  it('timestamps are spaced at 1/fs seconds (SamplingInterval=5000µs → 200 Hz)', async () => {
    mockFetch();
    const { data } = await loadBrainVisionEEG('h.vhdr', 'd.eeg');
    expect(data[0][1]).toBeCloseTo(1 / 200, 5);
    expect(data[0][2]).toBeCloseTo(2 / 200, 5);
  });
});

describe('loadBrainVisionEEG — de-multiplexing', () => {
  it('extracts channel 0 values from the interleaved buffer', async () => {
    mockFetch();
    const { data } = await loadBrainVisionEEG('h.vhdr', 'd.eeg');
    expect(Array.from(data[1])).toEqual([1, 2, 3]);
  });

  it('extracts channel 1 values from the interleaved buffer', async () => {
    mockFetch();
    const { data } = await loadBrainVisionEEG('h.vhdr', 'd.eeg');
    expect(Array.from(data[2])).toEqual([4, 5, 6]);
  });

  it('handles negative signal values', async () => {
    mockFetch(VHDR, makeEegBuffer([-1, -4, -2, -5, -3, -6]));
    const { data } = await loadBrainVisionEEG('h.vhdr', 'd.eeg');
    expect(Array.from(data[1])).toEqual([-1, -2, -3]);
    expect(Array.from(data[2])).toEqual([-4, -5, -6]);
  });
});

describe('loadBrainVisionEEG — File sources', () => {
  it('accepts File objects instead of URLs', async () => {
    const headerFile = new File([VHDR], 'test.vhdr', { type: 'text/plain' });
    const dataFile = new File([makeEegBuffer()], 'test.eeg');
    const { channelNames } = await loadBrainVisionEEG(headerFile, dataFile);
    expect(channelNames).toEqual(['Fp1', 'Fp2']);
  });

  it('de-multiplexes data correctly from File objects', async () => {
    const headerFile = new File([VHDR], 'test.vhdr', { type: 'text/plain' });
    const dataFile = new File([makeEegBuffer()], 'test.eeg');
    const { data } = await loadBrainVisionEEG(headerFile, dataFile);
    expect(Array.from(data[1])).toEqual([1, 2, 3]);
    expect(Array.from(data[2])).toEqual([4, 5, 6]);
  });
});

describe('loadBrainVisionEEG — fetch errors', () => {
  it('throws when the header request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, statusText: 'Not Found' }));
    await expect(loadBrainVisionEEG('missing.vhdr', 'd.eeg')).rejects.toThrow('Not Found');
  });

  it('throws when the data request fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(VHDR) })
      .mockResolvedValueOnce({ ok: false, statusText: 'Not Found' }),
    );
    await expect(loadBrainVisionEEG('h.vhdr', 'missing.eeg')).rejects.toThrow('Not Found');
  });
});
