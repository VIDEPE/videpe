import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import toast from 'react-hot-toast';
import { useElectrodeMatching, STANDARD_TEMPLATES } from '@/hooks/useElectrodeMatching';
import { buildElectrodeMesh } from '@/utils/eegTopographyUtils';

// react-hot-toast's default export is itself a callable function with .loading/.success/etc
// attached — a plain object mock would make the hook's toast(...) call throw silently.
// vi.mock is hoisted above the imports, so the `toast` import above is this mock.
vi.mock('react-hot-toast', () => {
  const toastFn = vi.fn();
  toastFn.loading = vi.fn();
  toastFn.success = vi.fn();
  toastFn.error = vi.fn();
  toastFn.dismiss = vi.fn();
  return { default: toastFn };
});

// EGI-style channel names: egiChannelNames(3) → ['E1', 'E2', 'E3'], egiChannelNames(3, '') → ['1', '2', '3']
const egiChannelNames = (count, prefix = 'E') =>
  Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
// 10-20 style channel names
const TEN_TWENTY_NAMES = [
  'Fp1',
  'Fp2',
  'F7',
  'F3',
  'Fz',
  'F4',
  'F8',
  'T7',
  'C3',
  'Cz',
  'C4',
  'T8',
  'P7',
  'P3',
  'Pz',
  'P4',
  'P8',
  'O1',
  'O2',
];
// Old nomenclature: T3/T4/T5/T6 instead of T7/T8/P7/P8 — only in standard_1020
const TEN_TWENTY_OLD_NAMES = TEN_TWENTY_NAMES.map(
  (name) => ({ T7: 'T3', T8: 'T4', P7: 'T5', P8: 'T6' })[name] ?? name
);
// 10-20 plus some 10-05 half positions ("h" names) — only in fsaverage_1005
const TEN_FIVE_NAMES = [...TEN_TWENTY_NAMES, 'AFF1h', 'FFC1h', 'FFC2h', 'FCC3h'];
// A short recording: every channel matches a template, but fewer than the 19 that the
// status LED needs to call a standard-template match good
const SHORT_TEN_TWENTY_NAMES = ['Fp1', 'Fp2', 'Cz'];
// Custom positions file covering every channel of SHORT_TEN_TWENTY_NAMES
const customElectrodes = [
  { label: 'Fp1', x: 1, y: 1, z: 1 },
  { label: 'Fp2', x: 2, y: 2, z: 2 },
  { label: 'Cz', x: 3, y: 3, z: 3 },
];
// SEEG style channel names:
// Primed group ("B'1") is always detected as SEEG, regardless of template match — see
// intracranialDetection.js's hasPrimedGroup short-circuit.
const seegChannelNames = ['B1', 'B2', "B'1"];

const setup = (overrides = {}) =>
  renderHook((props) => useElectrodeMatching(props), {
    initialProps: {
      channelNames: [],
      customElectrodes: [],
      customElecPosFileName: null,
      ...overrides,
    },
  });

// Toast mock calls would otherwise carry over between tests, letting a toast assertion
// pass on an earlier test's call.
beforeEach(() => {
  vi.clearAllMocks();
});

describe('useElectrodeMatching — bundled templates', () => {
  it.each(STANDARD_TEMPLATES.map((template) => [template.name, template]))(
    'bundled template %s parses into electrode positions without duplicate labels',
    (_, template) => {
      // check if electrodes are parsed from the template
      expect(template.electrodes.length).toBeGreaterThan(0);
      // check for duplicate labels
      const labels = template.electrodes.map(({ label }) => label.toLowerCase());
      expect(new Set(labels).size).toBe(labels.length);
    }
  );

  // A damaged line can parse into a wrong or missing electrode without any error, so this
  // checks the raw files instead of the parsed templates
  it.each(
    Object.entries(
      import.meta.glob('../../assets/electrode_positions/*.tsv', {
        query: '?raw',
        import: 'default',
        eager: true,
      })
    )
  )('template file %s has a name and three coordinates on every line', (_, text) => {
    const [, ...lines] = text.trim().split(/\r?\n/);
    lines.forEach((line) => {
      const [name, ...coordinates] = line.split('\t');
      expect(coordinates, name).toHaveLength(3);
      coordinates.forEach((value) => expect(Number.isFinite(Number(value)), name).toBe(true));
    });
  });

  // Two electrodes in the same direction from the head's centre would leave one out of the
  // mesh, so a recording using that name would have no voltage there. The templates are fixed
  // at build time, so this is caught here rather than at runtime — see the small offsets
  // described in the template README.
  it.each(STANDARD_TEMPLATES.map((template) => [template.name, template]))(
    'bundled template %s has every electrode in the topography mesh',
    (_, template) => {
      const { indices } = buildElectrodeMesh(template.electrodes);
      expect(new Set(indices).size).toBe(template.electrodes.length);
    }
  );

  it('gives every bundled template a unique id', () => {
    const ids = STANDARD_TEMPLATES.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Matched on id, not name: the name is UI text that may be tweaked, the id stays put
  it.each([
    [
      'modern 10-20 names (also fully in fsaverage_1005: the smaller template wins)',
      TEN_TWENTY_NAMES,
      'standard_1020',
    ],
    ['old 10-20 names', TEN_TWENTY_OLD_NAMES, 'standard_1020'],
    ['10-05 names', TEN_FIVE_NAMES, 'fsaverage_1005'],
    [
      'EGI 128, E-prefixed (also fully in the 256 net: the smaller template wins)',
      egiChannelNames(128),
      'template_EGI128_prefix_E',
    ],
    [
      'EGI 128, bare numbers (also fully in the 256 net: the smaller template wins)',
      egiChannelNames(128, ''),
      'template_EGI128',
    ],
    ['EGI 256, E-prefixed', egiChannelNames(256), 'template_EGI256_prefix_E'],
    ['EGI 256, bare numbers', egiChannelNames(256, ''), 'template_EGI256'],
    // More matched channels beats a higher share of the template used: the 128 net would
    // use 128/130 of its positions vs 200/258 for the 256 net, but leave E129–E200 unmatched
    [
      'EGI 256 with only E1–E200 exported (most matched channels wins)',
      egiChannelNames(200),
      'template_EGI256_prefix_E',
    ],
  ])('picks the right template for %s', (_, names, expectedTemplateId) => {
    const { result } = setup({ channelNames: names });
    expect(result.current.standardTemplateId).toBe(expectedTemplateId);
    expect(result.current.matched).toHaveLength(names.length);
  });
});

describe('useElectrodeMatching — recording-type detection', () => {
  it('detects EEG from the best template match and toasts it', () => {
    const { result } = setup({ channelNames: TEN_TWENTY_NAMES });
    // 19/19 10-20 names match → scalp EEG
    expect(result.current.detectedIsSeeg).toBe(false);
    expect(toast).toHaveBeenCalledWith('EEG recording detected', {
      id: expect.any(String),
      icon: '🔍',
    });
  });

  it('detects SEEG on the first render for intracranial-shaped channel names and toasts accordingly', () => {
    const { result } = setup({ channelNames: seegChannelNames });
    expect(result.current.detectedIsSeeg).toBe(true);
    expect(toast).toHaveBeenCalledWith('SEEG recording detected', {
      id: expect.any(String),
      icon: '🔍',
    });
  });

  it('re-detects when channelNames changes (new recording loaded)', () => {
    const { result, rerender } = setup({ channelNames: TEN_TWENTY_NAMES });
    expect(result.current.detectedIsSeeg).toBe(false);

    // rerender replaces the props entirely (initialProps aren't merged in), so pass them all
    rerender({ channelNames: seegChannelNames, customElectrodes: [], customElecPosFileName: null });
    expect(result.current.detectedIsSeeg).toBe(true);
  });
});

describe('useElectrodeMatching — render-facing electrodes', () => {
  it('uses the best-matching template for scalp EEG with no custom file', () => {
    const { result } = setup({ channelNames: TEN_FIVE_NAMES });
    const fsaverage1005 = STANDARD_TEMPLATES.find(({ id }) => id === 'fsaverage_1005');
    expect(result.current.electrodes).toBe(fsaverage1005.electrodes);
    expect(result.current.isStandardElectrodes).toBe(true);
  });

  it('uses the custom file over the standard template when present', () => {
    const { result } = setup({
      channelNames: SHORT_TEN_TWENTY_NAMES,
      customElectrodes,
      customElecPosFileName: 'custom.tsv',
    });
    expect(result.current.matched.length).toBe(3); // all 3 match custom
    expect(result.current.electrodes).toBe(customElectrodes);
    expect(result.current.isStandardElectrodes).toBe(false);
  });

  it('never falls back to the standard template for SEEG, even with no custom file', () => {
    const { result } = setup({ channelNames: seegChannelNames });
    expect(result.current.detectedIsSeeg).toBe(true);
    expect(result.current.electrodes).toEqual([]); // no custom electrodes supplied
    expect(result.current.isStandardElectrodes).toBe(false);
  });
});

describe('useElectrodeMatching — Electrode Position status LED', () => {
  it('flags a standard-template match of at least 19 channels as good', () => {
    const { result } = setup({ channelNames: TEN_TWENTY_NAMES });
    expect(result.current.electrodePositionMatchCount).toBe(19);
    expect(result.current.electrodePositionTotalCount).toBe(19);
    expect(result.current.isElectrodePositionMatchGoodForLed).toBe(true); // 19 ≥ 19
  });

  it('flags a standard-template match of fewer than 19 channels as not good, even at 100%', () => {
    const { result } = setup({ channelNames: SHORT_TEN_TWENTY_NAMES });
    expect(result.current.electrodePositionMatchCount).toBe(3);
    expect(result.current.electrodePositionTotalCount).toBe(3);
    expect(result.current.isElectrodePositionMatchGoodForLed).toBe(false); // 3 < 19
  });

  it('scores the status LED against the custom match ratio, not the standard template', () => {
    const { result } = setup({
      channelNames: SHORT_TEN_TWENTY_NAMES,
      customElectrodes,
      customElecPosFileName: 'custom.tsv',
    });
    expect(result.current.electrodePositionMatchCount).toBe(3);
    expect(result.current.electrodePositionTotalCount).toBe(3);
    expect(result.current.isElectrodePositionMatchGoodForLed).toBe(true); // 3/3 ≥ 0.9
  });

  it('flags a poor custom match as not good for the LED', () => {
    const sparseCustom = [{ label: 'Fp1', x: 1, y: 1, z: 1 }]; // 1/3 channels matched
    const { result } = setup({
      channelNames: SHORT_TEN_TWENTY_NAMES,
      customElectrodes: sparseCustom,
      customElecPosFileName: 'sparse.tsv',
    });
    expect(result.current.electrodePositionMatchCount).toBe(1);
    expect(result.current.isElectrodePositionMatchGoodForLed).toBe(false); // 1/3 < 0.9
  });

  it('leaves MatchCount/TotalCount undefined for SEEG with no custom file (nothing meaningful to show)', () => {
    const { result } = setup({ channelNames: seegChannelNames });
    expect(result.current.detectedIsSeeg).toBe(true);
    expect(result.current.electrodePositionMatchCount).toBeUndefined();
    expect(result.current.electrodePositionTotalCount).toBeUndefined();
  });

  it("still judges a custom file's own match quality in SEEG mode", () => {
    const depthElectrodes = [{ label: 'B1', x: 1, y: 1, z: 1 }]; // matches one of seegChannelNames
    const { result } = setup({
      channelNames: seegChannelNames,
      customElectrodes: depthElectrodes,
      customElecPosFileName: 'depth.tsv',
    });
    expect(result.current.electrodePositionMatchCount).toBe(1);
    expect(result.current.electrodePositionTotalCount).toBe(3);
  });
});
