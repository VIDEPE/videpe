import { describe, it, expect, afterEach, vi } from 'vitest';
import { loadEegTrc } from '@/loaders/loadEegTrc';
import { yieldToMain } from '@/utils/yieldToMain';

// The decode pauses between bursts via yieldToMain — replaced with an instant pause so tests
// can count pauses and run code (e.g. cancel) exactly during one.
vi.mock('@/utils/yieldToMain', () => ({ yieldToMain: vi.fn(() => Promise.resolve()) }));

// Round expected values to float32 precision, matching Float32Array storage
const f32 = (values) => Array.from(new Float32Array(values));

// Zone table entries, in file order (8-char names, space-padded)
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
const ORDER_POSITION = 640; // as in real files: the first zone starts right after the fixed header
const ELECTRODE_BYTES = 128; // one LABCOD electrode record

// Writes text at a fixed width, padded with null bytes (latin-1: one byte per character)
function writeText(view, offset, text, width) {
  for (let i = 0; i < width; i++) {
    view.setUint8(offset + i, i < text.length ? text.charCodeAt(i) & 0xff : 0);
  }
}

/**
 * Builds a Micromed TRC file (header type 4) in memory: the fixed header with its zone table,
 * the ORDER, LABCOD and TRONCA zones, then the samples — interleaved per time point, as
 * little-endian unsigned integers of `bytesPerSample` bytes.
 *
 * @param {Object} options
 * @param {Array<{ label: string, reference?: string, logicalMin?: number, logicalMax?: number,
 *   logicalGround?: number, physicalMin?: number, physicalMax?: number, unitCode?: number,
 *   rateCoefficient?: number, values: number[] }>} options.channels
 *   in data order. `values` are the stored (unsigned) integers. The ranges default to gain 1
 *   and ground 0, so physical value === stored value; unitCode defaults to 0 (µV).
 * @param {number} [options.rateMin=4] - base sampling rate (Hz).
 * @param {1|2|4} [options.bytesPerSample=2]
 * @param {number} [options.headerType=4]
 * @param {number[]} [options.order] - LABCOD electrode index of each channel (defaults to 0, 1, 2, ...).
 * @param {Array<[number, number]>} [options.cuts=[]] - TRONCA entries, written before the (0, 0) terminator.
 */
function makeTrc({
  channels,
  rateMin = 4,
  bytesPerSample = 2,
  headerType = 4,
  order = channels.map((_, i) => i),
  cuts = [],
}) {
  const nChannels = channels.length;
  const electrodes = channels.map((c) => ({
    reference: 'G2',
    logicalMin: 0,
    logicalMax: 65535,
    logicalGround: 0,
    physicalMin: 0,
    physicalMax: 65536, // = logicalMax − logicalMin + 1, so gain 1
    unitCode: 0,
    rateCoefficient: 1,
    ...c,
  }));

  // zone positions: ORDER, then LABCOD (large enough for the highest electrode index), then TRONCA
  const orderBytes = nChannels * 2;
  const labcodPosition = ORDER_POSITION + orderBytes;
  const labcodBytes = (Math.max(-1, ...order) + 1) * ELECTRODE_BYTES;
  const troncaPosition = labcodPosition + labcodBytes;
  const troncaBytes = (cuts.length + 1) * 8; // the cuts, then the (0, 0) terminator
  const dataStart = troncaPosition + troncaBytes;

  const header = new DataView(new ArrayBuffer(dataStart));
  writeText(header, 0, '* MICROMED  Brain-Quick file *', 32);
  writeText(header, 64, 'Test', 22);
  writeText(header, 86, 'Patient', 20);
  [6, 11, 123, 14, 35, 6].forEach((v, i) => header.setUint8(128 + i, v)); // 6 Nov 2023, 14:35:06
  header.setUint32(138, dataStart, true);
  header.setUint16(142, nChannels, true);
  header.setUint16(144, nChannels * bytesPerSample, true); // multiplexer
  header.setUint16(146, rateMin, true);
  header.setUint16(148, bytesPerSample, true);
  header.setUint8(175, headerType);

  const zones = {
    ORDER: [ORDER_POSITION, orderBytes],
    LABCOD: [labcodPosition, labcodBytes],
    TRONCA: [troncaPosition, troncaBytes],
  };
  ZONE_NAMES.forEach((name, i) => {
    const at = 176 + i * 16;
    const [position, length] = zones[name] ?? [0, 0]; // zones not used here are left empty
    writeText(header, at, name.padEnd(8, ' '), 8);
    header.setUint32(at + 8, position, true);
    header.setUint32(at + 12, length, true);
  });

  order.forEach((index, i) => header.setUint16(ORDER_POSITION + i * 2, index, true));

  electrodes.forEach((e, i) => {
    const at = labcodPosition + order[i] * ELECTRODE_BYTES;
    header.setUint8(at, 1); // status: acquired
    writeText(header, at + 2, e.label, 6);
    writeText(header, at + 8, e.reference, 6);
    [e.logicalMin, e.logicalMax, e.logicalGround, e.physicalMin, e.physicalMax].forEach((v, k) =>
      header.setInt32(at + 14 + k * 4, v, true)
    );
    header.setInt16(at + 34, e.unitCode, true);
    header.setUint16(at + 44, e.rateCoefficient, true);
  });

  cuts.forEach(([a, b], i) => {
    header.setUint32(troncaPosition + i * 8, a, true);
    header.setUint32(troncaPosition + i * 8 + 4, b, true);
  });

  const nSamples = channels[0]?.values.length ?? 0;
  const data = new DataView(new ArrayBuffer(nSamples * nChannels * bytesPerSample));
  const setSample = { 1: 'setUint8', 2: 'setUint16', 4: 'setUint32' }[bytesPerSample];
  let index = 0;
  for (let t = 0; t < nSamples; t++) {
    for (const c of channels) {
      data[setSample](index * bytesPerSample, c.values[t], true); // little-endian
      index++;
    }
  }
  return new File([header.buffer, data.buffer], 'test.trc');
}

// Reads the data start offset back from a built file — to know where the samples begin
async function readDataStart(file) {
  return new DataView(await file.slice(138, 142).arrayBuffer()).getUint32(0, true);
}

// Two channels, 3 samples at 4 Hz: Fp1 = 1, 2, 3; Fp2 = 4, 5, 6
const FS = 4;
const twoChannels = (overrides = {}) =>
  makeTrc({
    channels: [
      { label: 'Fp1 ', values: [1, 2, 3] },
      { label: 'Fp2', values: [4, 5, 6] },
    ],
    rateMin: FS,
    ...overrides,
  });

afterEach(() => {
  vi.restoreAllMocks();
  yieldToMain.mockClear();
});

describe('loadEegTrc — header', () => {
  it('returns the channel labels, trimmed of their padding', async () => {
    const { channelNames } = await loadEegTrc(twoChannels());
    expect(channelNames).toEqual(['Fp1', 'Fp2']);
  });

  it('looks each channel up in LABCOD through ORDER, not by its position in the data', async () => {
    // channel 0 is electrode 3 (Cz, gain 2), channel 1 is electrode 0 (Fp1, gain 1)
    const file = makeTrc({
      channels: [
        { label: 'Cz', physicalMax: 2 * 65536, values: [10, 11] },
        { label: 'Fp1', values: [20, 21] },
      ],
      order: [3, 0],
    });
    const provider = await loadEegTrc(file);
    expect(provider.channelNames).toEqual(['Cz', 'Fp1']);
    const { channels } = await provider.getChunk(0, provider.tMax);
    expect(Array.from(channels[0])).toEqual([20, 22]);
    expect(Array.from(channels[1])).toEqual([20, 21]);
  });

  it('returns fs = rateMin × rateCoefficient', async () => {
    const file = makeTrc({
      channels: [{ label: 'Cz', rateCoefficient: 2, values: [1, 2, 3, 4] }],
      rateMin: 256,
    });
    const { fs } = await loadEegTrc(file);
    expect(fs).toBe(512);
  });

  it('returns tMax = number of samples / fs, counted from the file size', async () => {
    const { tMax } = await loadEegTrc(twoChannels());
    expect(tMax).toBe(3 / FS);
  });

  it('ignores an incomplete sample frame at the end of the file', async () => {
    const file = new File([twoChannels(), new Uint8Array(1)], 'test.trc');
    const { tMax } = await loadEegTrc(file);
    expect(tMax).toBe(3 / FS);
  });

  it('rejects the whole recording when its channels have different sampling rates, naming the rates and channels', async () => {
    const file = makeTrc({
      channels: [
        { label: 'Fp1', rateCoefficient: 2, values: [1, 2] },
        { label: 'ECG', rateCoefficient: 1, values: [1, 2] },
      ],
      rateMin: 4,
    });
    await expect(loadEegTrc(file)).rejects.toThrow(/sampling rate.*8 Hz.*Fp1.*4 Hz.*ECG/is);
  });

  it('rejects a header type other than 4', async () => {
    await expect(loadEegTrc(twoChannels({ headerType: 3 }))).rejects.toThrow(
      /^TRC: .*header type/i
    );
  });

  it('rejects a file too small to hold a TRC header', async () => {
    await expect(loadEegTrc(new File(['not a trc'], 'bad.trc'))).rejects.toThrow(
      /TRC:.*too small/i
    );
  });

  it('rejects a file cut off before its data starts', async () => {
    // the fixed header (with its zone table) is complete, but the zones and data are missing
    const truncated = new File([twoChannels().slice(0, 600)], 'truncated.trc');
    await expect(loadEegTrc(truncated)).rejects.toThrow(/TRC:.*too small/i);
  });

  it('rejects a file that holds no channels', async () => {
    await expect(loadEegTrc(makeTrc({ channels: [] }))).rejects.toThrow(/TRC:.*no.*channel/i);
  });

  it('rejects a recording with cuts (TRONCA) — sample / fs is no longer the real time after a cut', async () => {
    await expect(loadEegTrc(twoChannels({ cuts: [[2, 10]] }))).rejects.toThrow(/^TRC: .*cut/i);
  });
});

describe('loadEegTrc — physical values', () => {
  const singleChannel = (channel, options = {}) =>
    makeTrc({ channels: [{ label: 'Cz', ...channel }], ...options });

  it('scales stored integers with the electrode ranges: (stored − logicalGround) × gain', async () => {
    // gain = (3200 − −3200) / (65535 − 0 + 1) = 0.09765625
    const file = singleChannel({
      logicalMin: 0,
      logicalMax: 65535,
      logicalGround: 32768,
      physicalMin: -3200,
      physicalMax: 3200,
      values: [32768, 32768 + 1024, 32768 - 2048],
    });
    const provider = await loadEegTrc(file);
    const { channels } = await provider.getChunk(0, provider.tMax);
    expect(Array.from(channels[0])).toEqual([0, 100, -200]);
  });

  it.each([1, 2, 4])('reads samples as unsigned integers of %d byte(s)', async (bytesPerSample) => {
    const max = 2 ** (8 * bytesPerSample) - 1; // would read as −1 if it were signed
    const provider = await loadEegTrc(singleChannel({ values: [1, max] }, { bytesPerSample }));
    const { channels } = await provider.getChunk(0, provider.tMax);
    expect(Array.from(channels[0])).toEqual(f32([1, max]));
  });

  it.each([
    [-1, 'nV', 1e-3],
    [0, 'µV', 1],
    [1, 'mV', 1e3],
    [2, 'V', 1e6],
  ])('converts unit code %d (%s) to µV (x%d)', async (unitCode, _, factor) => {
    const provider = await loadEegTrc(singleChannel({ unitCode, values: [2, 3] }));
    const { channels } = await provider.getChunk(0, provider.tMax);
    expect(Array.from(channels[0])).toEqual(f32([2 * factor, 3 * factor]));
  });

  it('keeps non-voltage signals (e.g. unit code 100, %) in their own unit', async () => {
    const provider = await loadEegTrc(singleChannel({ unitCode: 100, values: [97, 98] }));
    const { channels } = await provider.getChunk(0, provider.tMax);
    expect(Array.from(channels[0])).toEqual([97, 98]);
  });
});

describe('loadEegTrc — getChunk', () => {
  it('returns the full recording when requesting [0, tMax]', async () => {
    const provider = await loadEegTrc(twoChannels());
    const { timestamps, channels } = await provider.getChunk(0, provider.tMax);
    expect(Array.from(timestamps)).toEqual(f32([0, 1 / FS, 2 / FS]));
    expect(Array.from(channels[0])).toEqual([1, 2, 3]);
    expect(Array.from(channels[1])).toEqual([4, 5, 6]);
  });

  it('extracts a chunk starting mid-recording with absolute timestamps', async () => {
    const provider = await loadEegTrc(twoChannels());
    // Request samples 1..2 (skip sample 0)
    const { timestamps, channels } = await provider.getChunk(1 / FS, 3 / FS);
    expect(Array.from(timestamps)).toEqual(f32([1 / FS, 2 / FS]));
    expect(Array.from(channels[0])).toEqual([2, 3]);
    expect(Array.from(channels[1])).toEqual([5, 6]);
  });

  it('reads only the requested byte range via File.slice', async () => {
    const file = twoChannels();
    const dataStart = await readDataStart(file);
    const sliceSpy = vi.spyOn(file, 'slice');
    const provider = await loadEegTrc(file);
    await provider.getChunk(1 / FS, 3 / FS);
    // samples 1..3, 2 channels × 2 bytes => 4 bytes per sample frame
    expect(sliceSpy).toHaveBeenLastCalledWith(dataStart + 1 * 4, dataStart + 3 * 4);
  });

  it('clamps out-of-range requests to [0, tMax]', async () => {
    const provider = await loadEegTrc(twoChannels());
    const { timestamps, channels } = await provider.getChunk(-5, 1000);
    expect(Array.from(timestamps)).toEqual(f32([0, 1 / FS, 2 / FS]));
    expect(Array.from(channels[0])).toEqual([1, 2, 3]);
    expect(Array.from(channels[1])).toEqual([4, 5, 6]);
  });
});

describe('loadEegTrc — getChunk (large chunks and cancelling)', () => {
  // 1 channel × 25,000 samples; values are 0, 1, 2, ...
  const N_LARGE = 25000;
  const setupLarge = () =>
    makeTrc({
      channels: [{ label: 'Cz', values: Array.from({ length: N_LARGE }, (_, i) => i) }],
    });

  // Fake clock for the decode's time budget: every read advances it by `msPerRead`, so a test
  // decides whether the budget runs out (pause) or never does (no pause).
  const useFakeClock = (msPerRead) => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += msPerRead));
  };

  it('decodes correctly when it pauses many times along the way', async () => {
    useFakeClock(10); // every check is past the time budget → pause as often as possible
    const provider = await loadEegTrc(setupLarge());
    const { channels } = await provider.getChunk(0, provider.tMax);
    expect(yieldToMain.mock.calls.length).toBeGreaterThan(2);
    expect(channels[0]).toHaveLength(N_LARGE);
    for (const t of [0, 1, 4999, 5000, N_LARGE - 1]) {
      expect(channels[0][t]).toBe(t);
    }
  });

  it('does not pause when the whole chunk fits within the time budget', async () => {
    useFakeClock(0);
    const provider = await loadEegTrc(setupLarge());
    await provider.getChunk(0, provider.tMax);
    expect(yieldToMain).not.toHaveBeenCalled();
  });

  it('stops decoding when aborted during a pause', async () => {
    useFakeClock(10);
    const provider = await loadEegTrc(setupLarge());
    const controller = new AbortController();
    yieldToMain.mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve();
    });
    await expect(provider.getChunk(0, provider.tMax, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(yieldToMain).toHaveBeenCalledTimes(1);
  });

  it('rejects with an AbortError when the signal is already aborted', async () => {
    const provider = await loadEegTrc(setupLarge());
    const controller = new AbortController();
    controller.abort();
    await expect(provider.getChunk(0, provider.tMax, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('rejects with an AbortError when aborted while loading', async () => {
    const provider = await loadEegTrc(setupLarge());
    const controller = new AbortController();
    const chunkPromise = provider.getChunk(0, provider.tMax, controller.signal);
    controller.abort();
    await expect(chunkPromise).rejects.toMatchObject({ name: 'AbortError' });
  });
});
