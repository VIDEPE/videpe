import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { STANDARD_TEMPLATES } from '@/hooks/useElectrodeMatching';
import {
  useMontageTemplates,
  MONTAGE_TEMPLATES,
  MONTAGE_NAMING_SYSTEMS,
  MAP_1020_TO_EGI256_E_NAMES,
  MAP_1020_TO_EGI256_NUMBER_NAMES,
} from '@/hooks/useMontageTemplates';
import { isMontageRowDrawable } from '@/utils/eegViewerUtils';

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

describe('useMontageTemplates — Channel Map: 10-20 to EGI 256', () => {
  it('gives the E name of a 10-20 electrode', () => {
    expect(MAP_1020_TO_EGI256_E_NAMES.F8).toBe('E2');
    expect(MAP_1020_TO_EGI256_E_NAMES.F9).toBe('E252');
  });

  it('gives the bare number of a 10-20 electrode', () => {
    expect(MAP_1020_TO_EGI256_NUMBER_NAMES.F8).toBe('2');
    expect(MAP_1020_TO_EGI256_NUMBER_NAMES.F9).toBe('252');
  });

  // The net's reference electrode: Cz in some exports, VREF in others
  it('knows Cz as VREF in both tables', () => {
    expect(MAP_1020_TO_EGI256_E_NAMES.Cz).toBe('VREF');
    expect(MAP_1020_TO_EGI256_NUMBER_NAMES.Cz).toBe('VREF');
  });

  it('covers all 69 mapped electrodes plus Cz', () => {
    expect(Object.keys(MAP_1020_TO_EGI256_E_NAMES)).toHaveLength(70);
  });

  // Two 10-20 names on one electrode would be a typo in the list
  it('maps every 10-20 name to a different electrode', () => {
    expect(new Set(Object.values(MAP_1020_TO_EGI256_E_NAMES)).size).toBe(70);
  });
});

describe('useMontageTemplates — bundled templates', () => {
  it.each(MONTAGE_TEMPLATES.map((template) => [template.name, template]))(
    'bundled template %s parses into montage rows',
    (_, template) => {
      // check if rows are parsed from the template
      expect(template.rows.length).toBeGreaterThan(0);
      // every row names a channel; reference is null (referential) or another channel's name
      template.rows.forEach((row) => {
        expect(row.channel).toBeTruthy();
        expect(row.reference === null || typeof row.reference === 'string').toBe(true);
      });
      // channelTypes is always an object — empty for Cartool files, which carry no types
      expect(typeof template.channelTypes).toBe('object');
    }
  );

  it('gives every bundled template a unique id', () => {
    const ids = MONTAGE_TEMPLATES.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The name is what the user picks from in the dropdown — two identical entries there
  // would be indistinguishable
  it('gives every bundled template a unique name', () => {
    const names = MONTAGE_TEMPLATES.map(({ name }) => name);
    expect(new Set(names).size).toBe(names.length);
  });

  // The ids share the dropdown's value space with the built-in presets — a template id
  // equal to one of them would be applied as that preset instead
  it('never uses a built-in preset value as an id', () => {
    const ids = MONTAGE_TEMPLATES.map(({ id }) => id);
    ['none', 'custom', 'average'].forEach((preset) => expect(ids).not.toContain(preset));
  });
});

describe('useMontageTemplates — naming systems', () => {
  // The keys are written by hand — a typo would silently hide all montages for that system
  it('only uses electrode templates that exist', () => {
    const electrodeTemplateIds = STANDARD_TEMPLATES.map(({ id }) => id);
    Object.keys(MONTAGE_NAMING_SYSTEMS).forEach((id) => expect(electrodeTemplateIds).toContain(id));
  });
});

describe('useMontageTemplates — templates offered for a recording', () => {
  const offeredIds = (result) => result.current.map(({ id }) => id).sort();
  const setup = (props) =>
    renderHook((hookProps) => useMontageTemplates(hookProps), {
      initialProps: { detectedIsSeeg: false, ...props },
    });

  const ALL_MONTAGE_IDS = [
    'DoubleBanana_10-20',
    'Downsampled_10-20',
    'LongBipolar_10-20',
    'TransBipolar_10-20',
  ];
  const EGI_256_RECORDINGS = [
    ['E names', egiChannelNames(256), 'template_EGI256_prefix_E', 'E'],
    ['bare numbers', egiChannelNames(256, ''), 'template_EGI256', ''],
  ];

  it.each([
    ['GSN-HydroCel-256 with E names', egiChannelNames(256), 'template_EGI256_prefix_E'],
    ['GSN-HydroCel-256 with bare numbers', egiChannelNames(256, ''), 'template_EGI256'],
    ['10-20 names', TEN_TWENTY_NAMES, 'standard_1020'],
    ['10-05 names', TEN_TWENTY_NAMES, 'fsaverage_1005'],
  ])('offers every montage for %s', (_, channelNames, standardTemplateId) => {
    const { result } = setup({ channelNames, standardTemplateId });
    expect(offeredIds(result)).toEqual(ALL_MONTAGE_IDS);
  });

  it.each(EGI_256_RECORDINGS)(
    'names the EGI 256 montages apart from the 10-20 ones for %s',
    (_, channelNames, standardTemplateId) => {
      const { result } = setup({ channelNames, standardTemplateId });
      const names = result.current.map(({ name }) => name);
      expect(names).toContain('EGI 256 - Double Banana (10-20)');
    }
  );

  it('keeps the plain montage names for 10-20 recordings', () => {
    const { result } = setup({
      channelNames: TEN_TWENTY_NAMES,
      standardTemplateId: 'standard_1020',
    });
    expect(result.current.map(({ name }) => name)).toContain('Double Banana (10-20)');
  });

  // T3–T6 are the original 10-20 names of the positions the montage files call T7, T8, P7 and P8
  it.each(['standard_1020', 'fsaverage_1005'])(
    'translates the montages to the old T3–T6 names for %s',
    (standardTemplateId) => {
      const oldNames = { T7: 'T3', T8: 'T4', P7: 'T5', P8: 'T6' };
      const channelNames = TEN_TWENTY_NAMES.map((name) => oldNames[name] ?? name);
      const { result } = setup({ channelNames, standardTemplateId });

      const doubleBanana = result.current.find(({ id }) => id === 'DoubleBanana_10-20');
      const namesInRows = doubleBanana.rows.flatMap(({ channel, reference }) => [
        channel,
        reference,
      ]);
      Object.values(oldNames).forEach((name) => expect(namesInRows).toContain(name));
      Object.keys(oldNames).forEach((name) => expect(namesInRows).not.toContain(name));
    }
  );

  describe.each(EGI_256_RECORDINGS)(
    'an EGI 256 recording with %s',
    (_, channelNames, standardTemplateId, prefix) => {
      const longBipolar = (names) => {
        const { result } = setup({ channelNames: names, standardTemplateId });
        return result.current.find(({ id }) => id === 'LongBipolar_10-20');
      };

      it("translates the montage to the recording's own channel names", () => {
        const [firstRow] = longBipolar(channelNames).rows;
        expect(firstRow.channel).toBe(`${prefix}18`); // FP2 in the template file
        expect(firstRow.reference).toBe(`${prefix}226`); // F10 in the template file
      });

      it.each(['Cz', 'VREF'])('finds the reference electrode when it is named %s', (refName) => {
        const { rows } = longBipolar([...channelNames, refName]);
        expect(rows.at(-2)).toMatchObject({ channel: `${prefix}21`, reference: refName });
        expect(rows.at(-1)).toMatchObject({ channel: refName, reference: `${prefix}101` });
      });

      it('can draw every row of every montage', () => {
        const names = [...channelNames, 'Cz'];
        const { result } = setup({ channelNames: names, standardTemplateId });
        result.current.forEach(({ rows }) => {
          rows.forEach((row) => expect(isMontageRowDrawable(row, names)).toBe(true));
        });
      });
    }
  );

  // E1–E128 also exist in the 257 montages, but sit at different positions on the 128 net.
  // These templates get no montages until those have been verified.
  it.each([
    ['E names', egiChannelNames(128), 'template_EGI128_prefix_E'],
    ['bare numbers', egiChannelNames(128, ''), 'template_EGI128'],
  ])('offers nothing for GSN-HydroCel-128 with %s', (_, channelNames, standardTemplateId) => {
    const { result } = setup({ channelNames, standardTemplateId });
    expect(result.current).toEqual([]);
  });

  it('offers nothing for SEEG, even when the channel names look like 10-20 names', () => {
    const { result } = setup({
      channelNames: TEN_TWENTY_NAMES,
      standardTemplateId: 'standard_1020',
      detectedIsSeeg: true,
    });
    expect(result.current).toEqual([]);
  });

  // With 0 matches the electrode matching still returns its first template
  it('offers nothing when no row of any template can be drawn', () => {
    const { result } = setup({
      channelNames: ['Marker', 'Trigger'],
      standardTemplateId: 'fsaverage_1005',
    });
    expect(result.current).toEqual([]);
  });

  it('keeps a template when only some of its rows can be drawn', () => {
    const { result } = setup({ channelNames: ['Fp1'], standardTemplateId: 'standard_1020' });
    expect(offeredIds(result)).toContain('Downsampled_10-20');
  });

  it("returns the offered templates in the recording's own spelling", () => {
    const channelNames = TEN_TWENTY_NAMES.map((name) => name.toUpperCase());
    const { result } = setup({ channelNames, standardTemplateId: 'standard_1020' });

    const doubleBanana = result.current.find(({ id }) => id === 'DoubleBanana_10-20');
    const namesInRows = doubleBanana.rows.flatMap(({ channel, reference }) => [channel, reference]);
    expect(namesInRows).toContain('FP1'); // 'Fp1' in the template file
    expect(namesInRows).toContain('PZ'); // 'Pz' in the template file
    expect(namesInRows).not.toContain('Fp1');
    expect(namesInRows).not.toContain('Pz');
  });

  it('keeps the same list between renders, so the montage match is not recomputed', () => {
    const props = { channelNames: TEN_TWENTY_NAMES, standardTemplateId: 'standard_1020' };
    const { result, rerender } = setup(props);
    const firstList = result.current;

    rerender({ ...props, detectedIsSeeg: false });
    expect(result.current).toBe(firstList);
  });
});
