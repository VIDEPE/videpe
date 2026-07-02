import { describe, it, expect, vi } from 'vitest';
import { read as readmat } from 'mat-for-js';
import { parseInverseFiltersFieldtrip } from '@/loaders/parseInverseFiltersFieldtrip';

// mat-for-js does the actual MAT5 binary decoding — that's its job to get right, not ours
// to re-verify here. What we own is the adapter from its generic {header, data} shape to
// the fields ESI needs, so the binary decoder is mocked out entirely.
vi.mock('mat-for-js', () => ({ read: vi.fn() }));

// Shape confirmed against the real FieldTrip *_inversefilters.mat sample files: a struct
// with one filter entry per source position, empty for points outside the head model.
const FIXTURE = {
  header: 'MATLAB 5.0 MAT-file, Platform: PCWIN64, Created on: ...',
  data: {
    inverse_filters: {
      inside: [0, 1, 0],
      pos: [
        [-10, 20, 5],
        [-5, 15, 10],
        [0, 10, 15],
      ],
      filter: [
        [],
        [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
        [],
      ],
      elec: { label: ['1', '2'] },
    },
  },
};

// Builds a fixture identical to FIXTURE except for the given inverse_filters field
// overrides — lets each missing/empty-field test start from a known-good struct and
// only break the one field it's testing.
const withInverseFilters = (overrides) => ({
  header: FIXTURE.header,
  data: { inverse_filters: { ...FIXTURE.data.inverse_filters, ...overrides } },
});

describe('parseInverseFiltersFieldtrip', () => {
  it('returns the full expected shape for a valid file', async () => {
    readmat.mockReturnValue(FIXTURE);
    const file = new File(['irrelevant — read() is mocked'], 'mocked_file_inversefilters.mat');

    const result = await parseInverseFiltersFieldtrip(file);

    // Raw fields passed through from the MAT struct
    expect(result.format).toBe('FieldTrip');
    expect(result.sourcePositions).toEqual(FIXTURE.data.inverse_filters.pos);
    expect(result.insideMask).toEqual(FIXTURE.data.inverse_filters.inside);
    expect(result.channelLabels).toEqual(FIXTURE.data.inverse_filters.elec.label);

    // Pre-computed fields derived from the above (exact values tested in dedicated tests below)
    expect(result.nChannels).toBe(FIXTURE.data.inverse_filters.elec.label.length);
    expect(result.nInsideSources).toBe(1); // FIXTURE has inside=[0,1,0], one inside point
    expect(result.indicesInsideSources).toEqual([1]);
    expect(result.insideSourcePositions).toHaveLength(1);
    expect(result.flatSourceFilters).toBeInstanceOf(Float64Array);

    // sourceFilters (raw nested cell array) should not be in the return —
    // flatSourceFilters replaces it to avoid a duplicate ~20MB allocation
    expect(result.sourceFilters).toBeUndefined();
  });

  it('does not include raw sourceFilters in the return — replaced by flatSourceFilters', async () => {
    readmat.mockReturnValue(FIXTURE);
    const file = new File(['irrelevant — read() is mocked'], 'mocked_file_inversefilters.mat');

    const result = await parseInverseFiltersFieldtrip(file);

    expect(result.sourceFilters).toBeUndefined();
  });

  it('identifies inside-brain source indices and positions from insideMask', async () => {
    // FIXTURE has inside=[0,1,0] so only index 1 is inside, at pos [-5,15,10]
    readmat.mockReturnValue(FIXTURE);
    const file = new File(['irrelevant — read() is mocked'], 'mocked_file_inversefilters.mat');

    const result = await parseInverseFiltersFieldtrip(file);

    expect(result.indicesInsideSources).toEqual([1]);
    expect(result.nInsideSources).toBe(1);
    expect(result.insideSourcePositions).toEqual([FIXTURE.data.inverse_filters.pos[1]]);
  });

  it('packs inside-source filters into a flat Float64Array in row-major order', async () => {
    // FIXTURE has one inside source (index 1) with filter [[1,2],[3,4],[5,6]] and 2 channels.
    // Row-major packing: x-row [1,2], y-row [3,4], z-row [5,6] → [1,2,3,4,5,6]
    readmat.mockReturnValue(FIXTURE);
    const file = new File(['irrelevant — read() is mocked'], 'mocked_file_inversefilters.mat');

    const result = await parseInverseFiltersFieldtrip(file);

    expect(result.flatSourceFilters).toBeInstanceOf(Float64Array);
    expect(result.nChannels).toBe(2);
    expect(Array.from(result.flatSourceFilters)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('excludes outside-brain sources from flatSourceFilters', async () => {
    // FIXTURE has 3 total sources but only 1 inside — flat array must be length 1×3×2=6, not 3×3×2=18
    readmat.mockReturnValue(FIXTURE);
    const file = new File(['irrelevant — read() is mocked'], 'mocked_file_inversefilters.mat');

    const result = await parseInverseFiltersFieldtrip(file);

    expect(result.flatSourceFilters.length).toBe(1 * 3 * 2); // nInsideSources × 3 × nChannels
  });

  it("passes the file's bytes to mat-for-js as an ArrayBuffer", async () => {
    // tell readmat to return a the fixture instead of actually reading a file
    readmat.mockReturnValue(FIXTURE);
    const file = new File(['irrelevant — read() is mocked'], 'mocked_file_inversefilters.mat');

    await parseInverseFiltersFieldtrip(file);

    expect(readmat).toHaveBeenCalledWith(expect.any(ArrayBuffer));
  });

  it('rejects with a descriptive error when the file has no inverse_filters struct', async () => {
    // tell readmat to return a the fixture instead of actually reading a file
    readmat.mockReturnValue({ header: '...', data: {} });
    const file = new File(['irrelevant — read() is mocked'], 'mocked_file_inversefilters.mat');

    await expect(parseInverseFiltersFieldtrip(file)).rejects.toThrow(/inverse_filters/);
  });

  it.each([
    ['pos missing', { pos: undefined }, /pos/],
    ['pos empty', { pos: [] }, /pos/],
    ['filter missing', { filter: undefined }, /filter/],
    ['filter empty', { filter: [] }, /filter/],
    ['inside missing', { inside: undefined }, /inside/],
    ['inside empty', { inside: [] }, /inside/],
    ['elec missing entirely', { elec: undefined }, /elec/],
    ['elec.label missing', { elec: {} }, /elec/],
    ['elec.label empty', { elec: { label: [] } }, /elec/],
  ])('rejects with a descriptive error when %s', async (_caseName, overrides, messagePattern) => {
    // tell readmat to return a the fixture with the specified overrides instead of actually reading a file
    readmat.mockReturnValue(withInverseFilters(overrides));
    const file = new File(['irrelevant — read() is mocked'], 'mocked_file_inversefilters.mat');

    await expect(parseInverseFiltersFieldtrip(file)).rejects.toThrow(messagePattern);
  });
});
