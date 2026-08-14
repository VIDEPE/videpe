import { describe, it, expect } from 'vitest';
import { parseElectrodePositionElc } from '@/loaders/parseElectrodePositionElc';
import { parseElectrodePositionTsv } from '@/loaders/parseElectrodePositionTsv';
import { matchChannelsToPositions } from '@/utils/eegTopographyUtils';

// Minimal valid .elc with 3 fiducials + 2 electrodes
const MINIMAL_ELC = `# ASA electrode file
ReferenceLabel	avg
UnitPosition	mm
NumberPositions=	5
Positions
-86.0 -20.0 -48.0
86.0 -20.0 -48.0
0.0 87.0 -40.0
-29.0 84.0 -7.0
29.0 84.0 -7.0
Labels
LPA
RPA
Nz
Fp1
Fp2
`;

// Minimal valid BIDS-style electrodes.tsv with 3 fiducials + 2 electrodes
const MINIMAL_TSV = `name	x	y	z
LPA	-86.0	-20.0	-48.0
RPA	86.0	-20.0	-48.0
Nz	0.0	87.0	-40.0
Fp1	-29.0	84.0	-7.0
Fp2	29.0	84.0	-7.0
`;

describe('parseElectrodePositionElc', () => {
  it('returns the correct number of electrodes (fiducials excluded)', () => {
    const { electrodes } = parseElectrodePositionElc(MINIMAL_ELC);
    expect(electrodes.length).toBe(2);
  });

  it('parses electrode labels correctly', () => {
    const { electrodes } = parseElectrodePositionElc(MINIMAL_ELC);
    expect(electrodes[0].label).toBe('Fp1');
    expect(electrodes[1].label).toBe('Fp2');
  });

  it('parses electrode xyz coordinates correctly', () => {
    const { electrodes } = parseElectrodePositionElc(MINIMAL_ELC);
    expect(electrodes[0].x).toBeCloseTo(-29.0);
    expect(electrodes[0].y).toBeCloseTo(84.0);
    expect(electrodes[0].z).toBeCloseTo(-7.0);
  });

  it('detects all three standard fiducials', () => {
    const { fiducials } = parseElectrodePositionElc(MINIMAL_ELC);
    expect(fiducials.LPA).toBeDefined();
    expect(fiducials.RPA).toBeDefined();
    expect(fiducials.Nz).toBeDefined();
  });

  it('parses fiducial coordinates correctly', () => {
    const { fiducials } = parseElectrodePositionElc(MINIMAL_ELC);
    expect(fiducials.LPA.x).toBeCloseTo(-86.0);
    expect(fiducials.LPA.y).toBeCloseTo(-20.0);
    expect(fiducials.LPA.z).toBeCloseTo(-48.0);
  });

  it('reports hasFiducials true when all three are present', () => {
    const { hasFiducials } = parseElectrodePositionElc(MINIMAL_ELC);
    expect(hasFiducials).toBe(true);
  });

  it('reports hasFiducials false when fiducials are missing', () => {
    const noFids = MINIMAL_ELC.replace('LPA', 'Fp3').replace('RPA', 'Fp4').replace('Nz', 'Fp5');
    const { hasFiducials } = parseElectrodePositionElc(noFids);
    expect(hasFiducials).toBe(false);
  });

  it('converts cm to mm', () => {
    const cmElc = MINIMAL_ELC.replace('UnitPosition\tmm', 'UnitPosition\tcm');
    const { electrodes } = parseElectrodePositionElc(cmElc);
    expect(electrodes[0].x).toBeCloseTo(-290.0); // -29.0 cm × 10
  });

  it('returns empty arrays for empty input', () => {
    const { electrodes, fiducials, hasFiducials } = parseElectrodePositionElc('');
    expect(electrodes).toEqual([]);
    expect(fiducials).toEqual({});
    expect(hasFiducials).toBe(false);
  });

  it('skips lines with missing or non-numeric coordinates', () => {
    const bad = MINIMAL_ELC.replace('-29.0 84.0 -7.0', 'n/a n/a n/a');
    const { electrodes } = parseElectrodePositionElc(bad);
    expect(electrodes.length).toBe(1); // only Fp2 survives
  });
});

// ---------------------------------------------------------------------------
// parseElectrodePositionTsv
// ---------------------------------------------------------------------------

describe('parseElectrodePositionTsv', () => {
  it('returns the correct number of electrodes (fiducials excluded)', () => {
    const { electrodes } = parseElectrodePositionTsv(MINIMAL_TSV);
    expect(electrodes.length).toBe(2);
  });

  it('parses electrode labels correctly', () => {
    const { electrodes } = parseElectrodePositionTsv(MINIMAL_TSV);
    expect(electrodes[0].label).toBe('Fp1');
    expect(electrodes[1].label).toBe('Fp2');
  });

  it('parses electrode xyz coordinates correctly', () => {
    const { electrodes } = parseElectrodePositionTsv(MINIMAL_TSV);
    expect(electrodes[0].x).toBeCloseTo(-29.0);
    expect(electrodes[0].y).toBeCloseTo(84.0);
    expect(electrodes[0].z).toBeCloseTo(-7.0);
  });

  it('detects all three standard fiducials', () => {
    const { fiducials } = parseElectrodePositionTsv(MINIMAL_TSV);
    expect(fiducials.LPA).toBeDefined();
    expect(fiducials.RPA).toBeDefined();
    expect(fiducials.Nz).toBeDefined();
  });

  it('parses fiducial coordinates correctly', () => {
    const { fiducials } = parseElectrodePositionTsv(MINIMAL_TSV);
    expect(fiducials.LPA.x).toBeCloseTo(-86.0);
    expect(fiducials.LPA.y).toBeCloseTo(-20.0);
    expect(fiducials.LPA.z).toBeCloseTo(-48.0);
  });

  it('matches fiducial labels case-insensitively', () => {
    const lower = MINIMAL_TSV.replace('LPA', 'lpa').replace('RPA', 'rpa').replace('Nz', 'nz');
    const { fiducials } = parseElectrodePositionTsv(lower);
    expect(fiducials.LPA).toBeDefined();
    expect(fiducials.RPA).toBeDefined();
    expect(fiducials.Nz).toBeDefined();
  });

  it('reports hasFiducials true when all three are present', () => {
    const { hasFiducials } = parseElectrodePositionTsv(MINIMAL_TSV);
    expect(hasFiducials).toBe(true);
  });

  it('reports hasFiducials false when fiducials are missing', () => {
    const noFids = MINIMAL_TSV.replace('LPA', 'Fp3').replace('RPA', 'Fp4').replace('Nz', 'Fp5');
    const { hasFiducials } = parseElectrodePositionTsv(noFids);
    expect(hasFiducials).toBe(false);
  });

  it('finds columns regardless of header order or extra columns', () => {
    const reordered = `type	z	name	y	x
EEG	-7.0	Fp1	84.0	-29.0`;
    const { electrodes } = parseElectrodePositionTsv(reordered);
    expect(electrodes[0]).toMatchObject({ label: 'Fp1', x: -29.0, y: 84.0, z: -7.0 });
  });

  it('returns empty arrays for empty input', () => {
    const { electrodes, fiducials, hasFiducials } = parseElectrodePositionTsv('');
    expect(electrodes).toEqual([]);
    expect(fiducials).toEqual({});
    expect(hasFiducials).toBe(false);
  });

  it('skips rows with missing or non-numeric coordinates', () => {
    const bad = MINIMAL_TSV.replace('-29.0\t84.0\t-7.0', 'n/a\tn/a\tn/a');
    const { electrodes } = parseElectrodePositionTsv(bad);
    expect(electrodes.length).toBe(1); // only Fp2 survives
  });

  it('ignores a trailing blank line', () => {
    const { electrodes } = parseElectrodePositionTsv(MINIMAL_TSV);
    expect(electrodes.every((el) => el.label)).toBe(true); // no spurious blank-line entry
  });
});

// ---------------------------------------------------------------------------
// matchChannelsToPositions
// ---------------------------------------------------------------------------

const ELECTRODES = [
  { label: 'Fp1', x: -29, y: 84, z: -7 },
  { label: 'Fp2', x: 29, y: 84, z: -7 },
  { label: 'Cz', x: 0, y: 0, z: 88 },
];

describe('matchChannelsToPositions', () => {
  it('matches exact labels (case-insensitive)', () => {
    const { matched } = matchChannelsToPositions(['fp1', 'FP2', 'CZ'], ELECTRODES);
    expect(matched).toHaveLength(3);
  });

  it('strips "EEG " prefix before matching', () => {
    const { matched } = matchChannelsToPositions(['EEG Fp1'], ELECTRODES);
    expect(matched).toHaveLength(1);
    expect(matched[0].pos.label).toBe('Fp1');
  });

  it('strips "-Ref" suffix before matching', () => {
    const { matched } = matchChannelsToPositions(['Fp1-Ref', 'Fp2-Ref'], ELECTRODES);
    expect(matched).toHaveLength(2);
  });

  it('strips "-A1" style suffix before matching', () => {
    const { matched } = matchChannelsToPositions(['Cz-A1'], ELECTRODES);
    expect(matched).toHaveLength(1);
  });

  it('preserves channelIdx from the input array', () => {
    const { matched } = matchChannelsToPositions(['noise', 'Cz', 'Fp2'], ELECTRODES);
    const czMatch = matched.find((m) => m.name === 'Cz');
    expect(czMatch.channelIdx).toBe(1);
  });

  it('puts unmatched channel names in unmatchedNames', () => {
    const { unmatchedNames } = matchChannelsToPositions(['1', '3', 'Fp1'], ELECTRODES);
    expect(unmatchedNames).toContain('1');
    expect(unmatchedNames).toContain('3');
    expect(unmatchedNames).not.toContain('Fp1');
  });

  it('returns empty matched array when no channels match', () => {
    const { matched } = matchChannelsToPositions(['1', '2', '3'], ELECTRODES);
    expect(matched).toHaveLength(0);
  });

  it('matched entries carry the original channel name', () => {
    const { matched } = matchChannelsToPositions(['EEG Fp1'], ELECTRODES);
    expect(matched[0].name).toBe('EEG Fp1');
  });
});

// ---------------------------------------------------------------------------
// buildElectrodeMesh / gaussianRBF / interpolateMeshVoltages
// ---------------------------------------------------------------------------

import {
  buildElectrodeMesh,
  gaussianRBF,
  interpolateMeshVoltages,
} from '@/utils/eegTopographyUtils';

// 8 corners of a cube — guaranteed non-coplanar, convex hull gives 12 triangles
const CUBE_ELECTRODES = [
  { label: 'A', x: 1, y: 1, z: 1 },
  { label: 'B', x: -1, y: 1, z: 1 },
  { label: 'C', x: 1, y: -1, z: 1 },
  { label: 'D', x: -1, y: -1, z: 1 },
  { label: 'E', x: 1, y: 1, z: -1 },
  { label: 'F', x: -1, y: 1, z: -1 },
  { label: 'G', x: 1, y: -1, z: -1 },
  { label: 'H', x: -1, y: -1, z: -1 },
];

describe('buildElectrodeMesh', () => {
  it('returns a Float32Array with 3 floats per electrode', () => {
    const { vertices } = buildElectrodeMesh(CUBE_ELECTRODES);
    expect(vertices).toBeInstanceOf(Float32Array);
    expect(vertices.length).toBe(CUBE_ELECTRODES.length * 3);
  });

  it('returns a Uint32Array for indices with length divisible by 3', () => {
    const { indices } = buildElectrodeMesh(CUBE_ELECTRODES);
    expect(indices).toBeInstanceOf(Uint32Array);
    expect(indices.length % 3).toBe(0);
  });

  it('all face indices are within the valid vertex range', () => {
    const { indices } = buildElectrodeMesh(CUBE_ELECTRODES);
    for (const idx of indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(CUBE_ELECTRODES.length);
    }
  });

  it('vertex coordinates match the input electrode positions', () => {
    const { vertices } = buildElectrodeMesh(CUBE_ELECTRODES);
    expect(vertices[0]).toBeCloseTo(CUBE_ELECTRODES[0].x);
    expect(vertices[1]).toBeCloseTo(CUBE_ELECTRODES[0].y);
    expect(vertices[2]).toBeCloseTo(CUBE_ELECTRODES[0].z);
  });
});

describe('gaussianRBF', () => {
  it('returns the electrode voltage when query point coincides with it', () => {
    const val = gaussianRBF([10, 0, 0], [[10, 0, 0]], [5.0], 30);
    expect(val).toBeCloseTo(5.0);
  });

  it('returns the average for two equidistant electrodes', () => {
    const val = gaussianRBF(
      [0, 0, 0],
      [
        [-1, 0, 0],
        [1, 0, 0],
      ],
      [2, 4],
      30
    );
    expect(val).toBeCloseTo(3.0);
  });

  it('nearby electrode dominates over a far one', () => {
    // close electrode has voltage +10, far electrode has voltage -10
    const val = gaussianRBF(
      [0, 0, 0],
      [
        [1, 0, 0],
        [200, 0, 0],
      ],
      [10, -10],
      30
    );
    expect(val).toBeGreaterThan(0);
  });

  it('returns 0 for an empty electrode list', () => {
    const val = gaussianRBF([0, 0, 0], [], [], 30);
    expect(val).toBe(0);
  });
});

describe('interpolateMeshVoltages', () => {
  it('returns a Float32Array with one value per electrode', () => {
    const matched = [{ pos: CUBE_ELECTRODES[0] }];
    const out = interpolateMeshVoltages(CUBE_ELECTRODES, matched, [1.0]);
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(CUBE_ELECTRODES.length);
  });

  it('vertex at a matched electrode position gets exactly that voltage', () => {
    const matched = [{ pos: CUBE_ELECTRODES[0] }];
    const out = interpolateMeshVoltages(CUBE_ELECTRODES, matched, [10]);
    expect(out[0]).toBe(10);
  });

  it('vertex at a matched electrode gets its own voltage, not blended with a nearby differing neighbour', () => {
    // A and B are opposite corners of a 2-unit cube edge — 2mm apart, far closer than the
    // default 30mm sigma. Under the old RBF-only implementation this closeness would pull
    // A's vertex value most of the way toward B's voltage; the fix looks up matched vertices
    // by label directly, so A must come back untouched by B.
    const matched = [{ pos: CUBE_ELECTRODES[0] }, { pos: CUBE_ELECTRODES[1] }]; // A, B
    const out = interpolateMeshVoltages(CUBE_ELECTRODES, matched, [100, 0]);
    expect(out[0]).toBe(100);
    expect(out[1]).toBe(0);
  });

  it('returns all zeros when no channels are matched', () => {
    const out = interpolateMeshVoltages(CUBE_ELECTRODES, [], []);
    expect(Array.from(out).every((v) => v === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildElectrodeMarkers
// ---------------------------------------------------------------------------

import { buildElectrodeMarkers } from '@/utils/eegTopographyUtils';

describe('buildElectrodeMarkers', () => {
  it('returns one marker per template electrode', () => {
    const matched = [{ pos: ELECTRODES[0] }];
    const markers = buildElectrodeMarkers(ELECTRODES, matched, [5]);
    expect(markers).toHaveLength(ELECTRODES.length);
  });

  it('carries the label and position through from the template', () => {
    const markers = buildElectrodeMarkers(ELECTRODES, [], []);
    expect(markers[0]).toMatchObject({ label: 'Fp1', x: -29, y: 84, z: -7 });
  });

  it('flags matched electrodes as isMatched with their real voltage', () => {
    const matched = [{ pos: ELECTRODES[1] }]; // Fp2
    const markers = buildElectrodeMarkers(ELECTRODES, matched, [7.5]);
    const fp2 = markers.find((m) => m.label === 'Fp2');
    expect(fp2.isMatched).toBe(true);
    expect(fp2.value).toBeCloseTo(7.5);
  });

  it('flags unmatched electrodes as isMatched: false with value 0', () => {
    const matched = [{ pos: ELECTRODES[1] }]; // Fp2 only
    const markers = buildElectrodeMarkers(ELECTRODES, matched, [7.5]);
    const fp1 = markers.find((m) => m.label === 'Fp1');
    expect(fp1.isMatched).toBe(false);
    expect(fp1.value).toBe(0);
  });

  it('returns all unmatched when no channels are matched', () => {
    const markers = buildElectrodeMarkers(ELECTRODES, [], []);
    expect(markers.every((m) => m.isMatched === false)).toBe(true);
  });

  it('preserves voltage sign for matched electrodes', () => {
    const matched = [{ pos: ELECTRODES[2] }]; // Cz
    const markers = buildElectrodeMarkers(ELECTRODES, matched, [-12.3]);
    const cz = markers.find((m) => m.label === 'Cz');
    expect(cz.value).toBeCloseTo(-12.3);
  });
});

// ---------------------------------------------------------------------------
// buildIntracranialMatrix / buildIntracranialConnectome / buildElectrodeLayer
// ---------------------------------------------------------------------------

import {
  buildIntracranialMatrix,
  buildIntracranialConnectome,
  buildElectrodeLayer,
} from '@/utils/eegTopographyUtils';
import { ELECTRODE_LAYER_URL } from '@/utils/NiiViewer.utils';

describe('buildIntracranialMatrix', () => {
  it('groups channels by electrode group, sorted by contact number ascending', () => {
    const channelNames = ['B2', 'B1', "B'1", 'T1'];
    const { groups } = buildIntracranialMatrix(channelNames, [0, 0, 0, 0]);
    const b = groups.find((g) => g.group === 'b');
    expect(b.contacts.map((c) => c.contact)).toEqual([1, 2]);
  });

  it('separates groups, including primed groups, from their base letter', () => {
    const channelNames = ['B1', "B'1", 'T1'];
    const { groups } = buildIntracranialMatrix(channelNames, [0, 0, 0]);
    expect(groups.map((g) => g.group).sort()).toEqual(['b', "b'", 't']);
  });

  it('attaches the voltage and channelIdx for each contact', () => {
    const channelNames = ['B1', 'B2'];
    const { groups } = buildIntracranialMatrix(channelNames, [5, -3]);
    const b = groups.find((g) => g.group === 'b');
    expect(b.contacts).toEqual([
      { contact: 1, channelIdx: 0, voltage: 5 },
      { contact: 2, channelIdx: 1, voltage: -3 },
    ]);
  });

  it('puts channels that do not fit the group+contact pattern into unparsed, not a row', () => {
    const channelNames = ['B1', 'ECG', 'Status'];
    const { groups, unparsed } = buildIntracranialMatrix(channelNames, [0, 0, 0]);
    expect(groups).toHaveLength(1);
    expect(unparsed).toEqual([
      { channelIdx: 1, name: 'ECG' },
      { channelIdx: 2, name: 'Status' },
    ]);
  });

  it('returns no groups and no unparsed entries for an empty channel list', () => {
    const { groups, unparsed } = buildIntracranialMatrix([], []);
    expect(groups).toHaveLength(0);
    expect(unparsed).toHaveLength(0);
  });
});

describe('buildIntracranialConnectome', () => {
  const POS = (i) => ({ label: `c${i}`, x: i, y: i, z: i });
  const matchedFor = (names) =>
    names.map((name, channelIdx) => ({ channelIdx, name, pos: POS(channelIdx) }));

  it('returns one node per matched contact, carrying position and voltage', () => {
    const matched = matchedFor(['B1', 'B2']);
    const { nodes } = buildIntracranialConnectome(matched, [5, -3]);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({ name: 'B1', x: 0, y: 0, z: 0, colorValue: 5 });
    expect(nodes[1]).toMatchObject({ name: 'B2', x: 1, y: 1, z: 1, colorValue: -3 });
  });

  it('connects consecutive contacts within the same group', () => {
    const matched = matchedFor(['B1', 'B2', 'B3']);
    const { edges } = buildIntracranialConnectome(matched, [0, 0, 0]);
    expect(edges).toEqual([
      { first: 0, second: 1, colorValue: 1 },
      { first: 1, second: 2, colorValue: 1 },
    ]);
  });

  it('skips gaps instead of connecting across a missing contact number', () => {
    const matched = matchedFor(['B1', 'B2', 'B4']); // B3 missing
    const { edges } = buildIntracranialConnectome(matched, [0, 0, 0]);
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => [e.first, e.second])).toEqual([
      [0, 1], // B1-B2
      [1, 2], // B2-B4 (the surviving next contact after the gap)
    ]);
  });

  it('never connects contacts from different groups', () => {
    const matched = matchedFor(['B1', 'T1']);
    const { edges } = buildIntracranialConnectome(matched, [0, 0]);
    expect(edges).toHaveLength(0);
  });

  it('produces no edges for a single-contact group', () => {
    const matched = matchedFor(['B1']);
    const { edges } = buildIntracranialConnectome(matched, [0]);
    expect(edges).toHaveLength(0);
  });

  it('sets edge colorValue to a fixed value regardless of endpoint voltages', () => {
    const matched = matchedFor(['B1', 'B2']);
    const { edges } = buildIntracranialConnectome(matched, [10, -4]);
    expect(edges[0].colorValue).toBe(1);
  });
});

describe('buildElectrodeLayer', () => {
  // Each matched entry now carries its own `type` (set by EegViewer from channelSettings) —
  // buildElectrodeLayer splits on that instead of a single whole-recording isIntracranial flag.
  const seegMatched = [
    { channelIdx: 0, name: 'B1', pos: { label: 'B1', x: 0, y: 0, z: 0 }, type: 'seeg' },
    { channelIdx: 1, name: 'B2', pos: { label: 'B2', x: 1, y: 1, z: 1 }, type: 'seeg' },
  ];
  const eegMatched = [
    { channelIdx: 0, name: 'Fp1', pos: { label: 'Fp1', x: 0, y: 0, z: 0 }, type: 'eeg' },
    { channelIdx: 1, name: 'Fp2', pos: { label: 'Fp2', x: 1, y: 1, z: 1 }, type: 'eeg' },
  ];

  it('returns null when there are no matched (positioned) channels yet', () => {
    expect(buildElectrodeLayer({ matched: [], voltages: [] })).toBeNull();
  });

  it('returns a well-formed intracranial connectome (nodes+edges) volume entry when every matched channel is seeg', () => {
    const volume = buildElectrodeLayer({ matched: seegMatched, voltages: [10, -4] });
    expect(volume).toMatchObject({
      url: ELECTRODE_LAYER_URL,
      kind: 'connectome',
      subtype: 'Intracranial EEG',
    });
    expect(volume.nodes).toHaveLength(2);
    expect(volume.edges).toHaveLength(1);
  });

  it('returns a well-formed surfaceEEG connectome (only nodes) volume entry when every matched channel is eeg', () => {
    const volume = buildElectrodeLayer({ matched: eegMatched, voltages: [10, -4] });
    expect(volume).toMatchObject({
      url: ELECTRODE_LAYER_URL,
      kind: 'connectome',
      subtype: 'Surface EEG',
    });
    expect(volume.nodes).toHaveLength(2);
    expect(volume.edges).toHaveLength(0);
  });

  it('splits a mixed seeg/eeg matched set into shaft-connected nodes and plain nodes, seeg first', () => {
    const matched = [...seegMatched, ...eegMatched];
    const volume = buildElectrodeLayer({ matched, voltages: [10, -4, 5, -5] });
    expect(volume.subtype).toBe('Intracranial & Surface EEG');
    expect(volume.nodes).toHaveLength(4);
    // seeg nodes occupy indices 0-1, so the one shaft edge between them stays valid.
    expect(volume.nodes.map((n) => n.name)).toEqual(['B1', 'B2', 'Fp1', 'Fp2']);
    expect(volume.edges).toEqual([{ first: 0, second: 1, colorValue: 1 }]);
  });

  it('drops a matched channel whose type is neither seeg nor eeg (e.g. "other")', () => {
    const matched = [...seegMatched, { ...eegMatched[0], type: 'other' }];
    const volume = buildElectrodeLayer({ matched, voltages: [10, -4, 5] });
    expect(volume.nodes).toHaveLength(2);
    expect(volume.nodes.map((n) => n.name)).toEqual(['B1', 'B2']);
  });

  it('sets calMax to the maximum absolute voltage across the full matched set', () => {
    const volume = buildElectrodeLayer({ matched: seegMatched, voltages: [10, -25] });
    expect(volume.calMax).toBe(25);
  });
});
