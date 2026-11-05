import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMontageTemplates, MONTAGE_TEMPLATES } from '@/hooks/useMontageTemplates';

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

describe('useMontageTemplates — hook', () => {
  // Bundled at build time, so there's no loading period: the full list on the first render
  it('returns every bundled template on the first render', () => {
    const { result } = renderHook(() => useMontageTemplates());
    expect(result.current).toBe(MONTAGE_TEMPLATES);
  });
});
