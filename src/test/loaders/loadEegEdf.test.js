import { describe, it, expect, afterEach, vi } from 'vitest';
import { loadEegEdf } from '@/loaders/loadEegEdf';
import { yieldToMain } from '@/utils/yieldToMain';

// The decode pauses between bursts via yieldToMain — replaced with an instant pause so tests
// can count pauses and run code (e.g. cancel) exactly during one.
vi.mock('@/utils/yieldToMain', () => ({ yieldToMain: vi.fn(() => Promise.resolve()) }));

// Round expected values to float32 precision, matching Float32Array storage
const f32 = (values) => Array.from(new Float32Array(values));

// Pads (or cuts) a header field to its fixed width, as EDF stores them: space-padded ASCII
const field = (value, width) => String(value).padEnd(width, ' ').slice(0, width);

/**
 * Builds an EDF file in memory: a 256-byte fixed header, 256 header bytes per signal, then
 * the data records — per record, each signal's samples in turn, as int16 little-endian.
 *
 * @param {Object} options
 * @param {Array<{ label: string, unit?: string, physicalMin?: number, physicalMax?: number,
 *   digitalMin?: number, digitalMax?: number, samplesPerRecord: number, values: number[] }>} options.signals
 *   `values` are the stored (digital) integers across the whole recording. Physical and
 *   digital ranges default to equal, so physical value === stored value.
 * @param {number|string} [options.recordDuration=1] - seconds per record, written as-is.
 * @param {number} [options.headerRecords] - record count written in the header (defaults to
 *   the real count; -1 means "unknown").
 * @param {number} [options.headerBytes] - header size written in the header (defaults to the real size).
 * @param {string} [options.reserved='EDF+C'] - the reserved field: '' (plain EDF), 'EDF+C'
 *   (continuous) or 'EDF+D' (discontinuous).
 */
function makeEdf({ signals, recordDuration = 1, headerRecords, headerBytes, reserved = 'EDF+C' }) {
  const nRecords = signals[0].values.length / signals[0].samplesPerRecord;
  const realHeaderBytes = 256 * (signals.length + 1);
  const withDefaults = signals.map((s) => ({
    unit: 'uV',
    physicalMin: -32768,
    physicalMax: 32767,
    digitalMin: -32768,
    digitalMax: 32767,
    ...s,
  }));

  let header =
    field('0', 8) +
    field('X X X X', 80) +
    field('Startdate 01-JAN-2024 X X X', 80) +
    field('01.01.24', 8) +
    field('00.00.00', 8) +
    field(headerBytes ?? realHeaderBytes, 8) +
    field(reserved, 44) +
    field(headerRecords ?? nRecords, 8) +
    field(recordDuration, 8) +
    field(signals.length, 4);
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
  for (const [key, width] of signalFields) {
    for (const s of withDefaults) header += field(s[key] ?? '', width);
  }
  // latin-1: one byte per character (so 'µ' is 0xB5)
  const headerArray = Uint8Array.from(header, (c) => c.charCodeAt(0) & 0xff);

  const recordSamples = signals.reduce((sum, s) => sum + s.samplesPerRecord, 0);
  const data = new DataView(new ArrayBuffer(nRecords * recordSamples * 2));
  let index = 0;
  for (let r = 0; r < nRecords; r++) {
    for (const s of signals) {
      for (let i = 0; i < s.samplesPerRecord; i++) {
        data.setInt16(index * 2, s.values[r * s.samplesPerRecord + i], true); // little-endian
        index++;
      }
    }
  }
  return new File([headerArray, data.buffer], 'test.edf');
}

// Two channels, 2 records of 1 s at 3 Hz: Fp1 = 1..6, Fp2 = -1..-6
const FS = 3;
const twoChannels = (overrides = {}) =>
  makeEdf({
    signals: [
      { label: 'Fp1 ', samplesPerRecord: 3, values: [1, 2, 3, 4, 5, 6] },
      { label: 'Fp2', samplesPerRecord: 3, values: [-1, -2, -3, -4, -5, -6] },
    ],
    ...overrides,
  });

afterEach(() => {
  vi.restoreAllMocks();
  yieldToMain.mockClear();
});

describe('loadEegEdf — header', () => {
  it('returns the channel labels, trimmed of their padding', async () => {
    const { channelNames } = await loadEegEdf(twoChannels());
    expect(channelNames).toEqual(['Fp1', 'Fp2']);
  });

  it('returns fs = samples per record / record duration', async () => {
    const file = makeEdf({
      signals: [{ label: 'Cz', samplesPerRecord: 4, values: [1, 2, 3, 4] }],
      recordDuration: 0.5,
    });
    const { fs } = await loadEegEdf(file);
    expect(fs).toBe(8);
  });

  it('reads a record duration written with a decimal comma', async () => {
    const file = makeEdf({
      signals: [{ label: 'Cz', samplesPerRecord: 4, values: [1, 2, 3, 4] }],
      recordDuration: '0,5',
    });
    const { fs } = await loadEegEdf(file);
    expect(fs).toBe(8);
  });

  it('treats a record duration of 0 as 1 second, like MNE', async () => {
    const file = makeEdf({
      signals: [{ label: 'Cz', samplesPerRecord: 4, values: [1, 2, 3, 4] }],
      recordDuration: 0,
    });
    const { fs, tMax } = await loadEegEdf(file);
    expect(fs).toBe(4);
    expect(tMax).toBe(1);
  });

  it('returns tMax = number of records * record duration', async () => {
    const { tMax } = await loadEegEdf(twoChannels());
    expect(tMax).toBe(2);
  });

  it('counts the records from the file size when the header says -1 (unknown)', async () => {
    const { tMax } = await loadEegEdf(twoChannels({ headerRecords: -1 }));
    expect(tMax).toBe(2);
  });

  it('counts the records from the file size when the header claims more than the file holds', async () => {
    const { tMax } = await loadEegEdf(twoChannels({ headerRecords: 10 }));
    expect(tMax).toBe(2);
  });

  it('leaves the EDF+ annotations signal out of the channels', async () => {
    const file = makeEdf({
      signals: [
        { label: 'Fp1', samplesPerRecord: 3, values: [1, 2, 3, 4, 5, 6] },
        { label: 'EDF Annotations', samplesPerRecord: 2, values: [0, 0, 0, 0] },
      ],
    });
    const { channelNames } = await loadEegEdf(file);
    expect(channelNames).toEqual(['Fp1']);
  });

  it('rejects the whole recording when its channels have different sampling rates, naming the rates and channels', async () => {
    const file = makeEdf({
      signals: [
        { label: 'Fp1', samplesPerRecord: 4, values: [1, 2, 3, 4] },
        { label: 'SpO2', samplesPerRecord: 1, values: [97] },
      ],
    });
    await expect(loadEegEdf(file)).rejects.toThrow(/sampling rate.*4 Hz.*Fp1.*1 Hz.*SpO2/is);
  });

  it('rejects a file whose header size does not match its number of signals', async () => {
    // 2 signals → the real header is 256 * (2 + 1) = 768 bytes
    await expect(loadEegEdf(twoChannels({ headerBytes: 512 }))).rejects.toThrow(
      /EDF:.*header size/i
    );
  });

  it('rejects a file too small to hold an EDF header', async () => {
    await expect(loadEegEdf(new File(['not an edf'], 'bad.edf'))).rejects.toThrow(
      /EDF:.*too small/i
    );
  });

  it('rejects a file cut off before the end of its signal headers', async () => {
    // a valid fixed header (256 bytes) announcing 2 signals, but only part of their 512 header bytes
    const truncated = new File([twoChannels().slice(0, 300)], 'truncated.edf');
    await expect(loadEegEdf(truncated)).rejects.toThrow(/EDF:.*too small/i);
  });

  it('rejects a file that holds only the annotations signal', async () => {
    const file = makeEdf({
      signals: [{ label: 'EDF Annotations', samplesPerRecord: 2, values: [0, 0] }],
    });
    await expect(loadEegEdf(file)).rejects.toThrow(/no signal channels/i);
  });

  it('rejects a discontinuous (EDF+D) recording — its records can have gaps between them', async () => {
    await expect(loadEegEdf(twoChannels({ reserved: 'EDF+D' }))).rejects.toThrow(/^EDF: .*EDF\+D/);
  });

  it.each([
    ['plain EDF', ''],
    ['EDF+C', 'EDF+C'],
  ])('loads a continuous recording (%s)', async (_, reserved) => {
    const { channelNames } = await loadEegEdf(twoChannels({ reserved }));
    expect(channelNames).toEqual(['Fp1', 'Fp2']);
  });
});

describe('loadEegEdf — physical values', () => {
  const singleChannel = (signal) =>
    makeEdf({ signals: [{ label: 'Cz', samplesPerRecord: 2, ...signal }] });

  it('scales stored integers to physical values from the physical/digital ranges', async () => {
    // cal = (500 - -500) / (1000 - 0) = 1; offset = -500 - 0 * 1 = -500
    const file = singleChannel({
      physicalMin: -500,
      physicalMax: 500,
      digitalMin: 0,
      digitalMax: 1000,
      values: [600, 0],
    });
    const provider = await loadEegEdf(file);
    const { channels } = await provider.getChunk(0, provider.tMax);
    expect(Array.from(channels[0])).toEqual([100, -500]);
  });

  it('applies a gain other than 1', async () => {
    // cal = 1000 / 100 = 10, offset 0
    const file = singleChannel({
      physicalMin: 0,
      physicalMax: 1000,
      digitalMin: 0,
      digitalMax: 100,
      values: [5, -3],
    });
    const provider = await loadEegEdf(file);
    const { channels } = await provider.getChunk(0, provider.tMax);
    expect(Array.from(channels[0])).toEqual([50, -30]);
  });

  it.each([
    ['uV', 1],
    ['µV', 1], // micro sign, as written in latin-1
    ['mV', 1000],
    ['V', 1_000_000],
  ])('converts %s to µV (x%d)', async (unit, factor) => {
    const provider = await loadEegEdf(singleChannel({ unit, values: [2, -3] }));
    const { channels } = await provider.getChunk(0, provider.tMax);
    expect(Array.from(channels[0])).toEqual(f32([2 * factor, -3 * factor]));
  });

  it('keeps non-voltage signals (e.g. %) in their own unit', async () => {
    const provider = await loadEegEdf(singleChannel({ unit: '%', values: [97, 98] }));
    const { channels } = await provider.getChunk(0, provider.tMax);
    expect(Array.from(channels[0])).toEqual([97, 98]);
  });
});

describe('loadEegEdf — getChunk', () => {
  it('returns the full recording when requesting [0, tMax]', async () => {
    const provider = await loadEegEdf(twoChannels());
    const { timestamps, channels } = await provider.getChunk(0, provider.tMax);
    expect(Array.from(timestamps)).toEqual(f32([0, 1, 2, 3, 4, 5].map((t) => t / FS)));
    expect(Array.from(channels[0])).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(channels[1])).toEqual([-1, -2, -3, -4, -5, -6]);
  });

  it('returns the whole records covering the requested range, with absolute timestamps', async () => {
    // 4 records of 1 s with 2 samples each (2 Hz): record r holds values 2r and 2r + 1
    const file = makeEdf({
      signals: [{ label: 'Cz', samplesPerRecord: 2, values: [0, 1, 2, 3, 4, 5, 6, 7] }],
    });
    const provider = await loadEegEdf(file);
    // 1.5 s – 2.5 s starts in the middle of record 1 and ends in the middle of record 2
    // getChunk should return complete records => return record 1 and 2
    const { timestamps, channels } = await provider.getChunk(1.5, 2.5);
    // so records 1 and 2 come back whole (1 s – 3 s), and records 0 and 3 not at all
    expect(Array.from(timestamps)).toEqual(f32([1, 1.5, 2, 2.5]));
    expect(Array.from(channels[0])).toEqual([2, 3, 4, 5]);
  });

  it('decodes channels correctly when an annotations signal sits between them in each record', async () => {
    const file = makeEdf({
      signals: [
        { label: 'Fp1', samplesPerRecord: 2, values: [1, 2, 3, 4] },
        { label: 'EDF Annotations', samplesPerRecord: 3, values: [9, 9, 9, 9, 9, 9] },
        { label: 'Fp2', samplesPerRecord: 2, values: [5, 6, 7, 8] },
      ],
    });
    const provider = await loadEegEdf(file);
    const { channels } = await provider.getChunk(0, provider.tMax);
    expect(Array.from(channels[0])).toEqual([1, 2, 3, 4]);
    expect(Array.from(channels[1])).toEqual([5, 6, 7, 8]);
  });

  it('reads only the records covering the requested range via File.slice', async () => {
    const file = makeEdf({
      signals: [{ label: 'Cz', samplesPerRecord: 2, values: [1, 2, 3, 4, 5, 6, 7, 8] }],
    });
    const sliceSpy = vi.spyOn(file, 'slice');
    const provider = await loadEegEdf(file);
    await provider.getChunk(2.5, 3); // inside record 2 only
    // header: 256 * 2 bytes; each record: 2 samples * 2 bytes
    expect(sliceSpy).toHaveBeenLastCalledWith(512 + 2 * 4, 512 + 3 * 4);
  });

  it('clamps out-of-range requests to [0, tMax]', async () => {
    const provider = await loadEegEdf(twoChannels());
    const { channels } = await provider.getChunk(-5, 1000);
    expect(Array.from(channels[0])).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('loadEegEdf — getChunk (large chunks and cancelling)', () => {
  // 1 channel × 2,000 records of 5 samples; values are 0, 1, 2, ...
  const N_RECORDS = 2000;
  const setupLarge = () =>
    makeEdf({
      signals: [
        {
          label: 'Cz',
          samplesPerRecord: 5,
          values: Array.from({ length: N_RECORDS * 5 }, (_, i) => i),
        },
      ],
    });

  // Fake clock for the decode's time budget: every read advances it by `msPerRead`, so a test
  // decides whether the budget runs out (pause) or never does (no pause).
  const useFakeClock = (msPerRead) => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += msPerRead));
  };

  it('decodes correctly when it pauses many times along the way', async () => {
    useFakeClock(10); // every check is past the time budget → pause as often as possible
    const provider = await loadEegEdf(setupLarge());
    const { channels } = await provider.getChunk(0, provider.tMax);
    expect(yieldToMain.mock.calls.length).toBeGreaterThan(2);
    expect(channels[0]).toHaveLength(N_RECORDS * 5);
    for (const t of [0, 4, 5, 6, 4999, 5000, N_RECORDS * 5 - 1]) {
      expect(channels[0][t]).toBe(t);
    }
  });

  it('does not pause when the whole chunk fits within the time budget', async () => {
    useFakeClock(0);
    const provider = await loadEegEdf(setupLarge());
    await provider.getChunk(0, provider.tMax);
    expect(yieldToMain).not.toHaveBeenCalled();
  });

  it('stops decoding when aborted during a pause', async () => {
    useFakeClock(10);
    const provider = await loadEegEdf(setupLarge());
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
    const provider = await loadEegEdf(setupLarge());
    const controller = new AbortController();
    controller.abort();
    await expect(provider.getChunk(0, provider.tMax, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('rejects with an AbortError when aborted while loading', async () => {
    const provider = await loadEegEdf(setupLarge());
    const controller = new AbortController();
    const chunkPromise = provider.getChunk(0, provider.tMax, controller.signal);
    controller.abort();
    await expect(chunkPromise).rejects.toMatchObject({ name: 'AbortError' });
  });
});
