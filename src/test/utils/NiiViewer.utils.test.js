import { describe, it, expect, vi } from 'vitest';

// NiiViewer.utils.js imports isMeshExt/isDicomExtension from @niivue/niivue at module scope —
// none of the functions tested here touch either one (filesToLayers/isDicomFile, which do, are
// already covered via the real package through NiiViewer.test.jsx's own mock), so this is a
// minimal stand-in just to keep that import from pulling in the real package.
vi.mock('@niivue/niivue', () => ({
  isMeshExt: vi.fn(),
  isDicomExtension: vi.fn(),
}));

import {
  isImageVolumeLayer,
  getCurrentMeshXRay,
  getCalBounds,
  fractionToCalValue,
  makeLayerMergeUpdater,
  makeSettingsMergeUpdater,
  isAnyColorbarActive,
  ESI_LAYER_URL,
  ELECTRODE_LAYER_URL,
} from '@/utils/NiiViewer.utils';

describe('isAnyColorbarActive', () => {
  const setting = (overrides = {}) => ({ showColorbar: false, visible: true, ...overrides });

  it('is false when no layer wants a colorbar', () => {
    expect(isAnyColorbarActive([setting(), setting()])).toBe(false);
  });

  it('is true when a visible layer wants a colorbar', () => {
    expect(isAnyColorbarActive([setting(), setting({ showColorbar: true })])).toBe(true);
  });

  it('is false when the only layer wanting a colorbar is hidden', () => {
    expect(isAnyColorbarActive([setting({ showColorbar: true, visible: false })])).toBe(false);
  });

  it('is true when a hidden layer wants a colorbar but a visible layer also does', () => {
    const layers = [
      setting({ showColorbar: true, visible: false }),
      setting({ showColorbar: true, visible: true }),
    ];
    expect(isAnyColorbarActive(layers)).toBe(true);
  });

  it('is false for an empty layer list', () => {
    expect(isAnyColorbarActive([])).toBe(false);
  });
});

describe('isImageVolumeLayer', () => {
  it('is true for a plain image volume (no kind, or kind other than connectome/mesh)', () => {
    expect(isImageVolumeLayer({ type: 'MRI' })).toBe(true);
    expect(isImageVolumeLayer({ type: 'MRI', kind: 'volume' })).toBe(true);
  });

  it('is false for a connectome layer', () => {
    expect(isImageVolumeLayer({ kind: 'connectome' })).toBe(false);
  });

  it('is false for a mesh layer', () => {
    expect(isImageVolumeLayer({ kind: 'mesh' })).toBe(false);
  });
});

describe('getCurrentMeshXRay', () => {
  it('returns 1 (the default) when there is no mesh/connectome layer yet', () => {
    const layers = [{ type: 'MRI' }, { type: 'PET' }];
    const layerSettings = [{ meshXRay: 1 }, { meshXRay: 0.6 }];
    expect(getCurrentMeshXRay(layers, layerSettings)).toBe(1);
  });

  it("returns the first mesh/connectome layer's meshXRay", () => {
    const layers = [{ type: 'MRI' }, { kind: 'connectome', url: ELECTRODE_LAYER_URL }];
    const layerSettings = [{ meshXRay: 1 }, { meshXRay: 0.4 }];
    expect(getCurrentMeshXRay(layers, layerSettings)).toBe(0.4);
  });

  it('finds the first mesh/connectome even when several are present, not the last', () => {
    const layers = [
      { type: 'MRI' },
      { kind: 'mesh', url: 'blob:cortex' },
      { kind: 'connectome', url: ELECTRODE_LAYER_URL },
    ];
    const layerSettings = [{ meshXRay: 1 }, { meshXRay: 0.7 }, { meshXRay: 0.2 }];
    expect(getCurrentMeshXRay(layers, layerSettings)).toBe(0.7);
  });
});

describe('getCalBounds', () => {
  it('reads boundMin/boundMax straight off the layer for the ESI layer', () => {
    const layer = { url: ESI_LAYER_URL, boundMin: 2, boundMax: 20 };
    expect(getCalBounds(layer, { robust_min: 0, robust_max: 1 })).toEqual({
      boundMin: 2,
      boundMax: 20,
    });
  });

  it('reads robust_min/robust_max off the NVImage for a regular volume', () => {
    const layer = { url: 'blob:mri' };
    expect(getCalBounds(layer, { robust_min: 10, robust_max: 200 })).toEqual({
      boundMin: 10,
      boundMax: 200,
    });
  });

  it('defaults to 0/1 for a regular volume when nvVolume is missing', () => {
    const layer = { url: 'blob:mri' };
    expect(getCalBounds(layer, undefined)).toEqual({ boundMin: 0, boundMax: 1 });
  });
});

describe('fractionToCalValue', () => {
  it('resolves a 0-1 fraction to a real value within [boundMin, boundMax]', () => {
    expect(fractionToCalValue(0, 10, 20)).toBe(10);
    expect(fractionToCalValue(1, 10, 20)).toBe(20);
    expect(fractionToCalValue(0.5, 10, 20)).toBe(15);
  });

  it('works with a negative boundMin', () => {
    expect(fractionToCalValue(0.5, -10, 10)).toBe(0);
  });
});

describe('makeLayerMergeUpdater', () => {
  const OTHER = { url: '/mri.nii', type: 'MRI' };

  it('no layer + not already present: no-op', () => {
    const updater = makeLayerMergeUpdater(null, ELECTRODE_LAYER_URL);
    const prev = [OTHER];
    expect(updater(prev)).toBe(prev); // same reference — genuinely a no-op, not just equal
  });

  it('no layer + already present: removes it, leaving everything else untouched', () => {
    const existing = { url: ELECTRODE_LAYER_URL, nodes: [] };
    const updater = makeLayerMergeUpdater(null, ELECTRODE_LAYER_URL);
    expect(updater([OTHER, existing])).toEqual([OTHER]);
  });

  it('has layer + not already present: appends it', () => {
    const layer = { url: ELECTRODE_LAYER_URL, nodes: [] };
    const updater = makeLayerMergeUpdater(layer, ELECTRODE_LAYER_URL);
    expect(updater([OTHER])).toEqual([OTHER, layer]);
  });

  it('has layer + already present + same object reference: no-op', () => {
    const layer = { url: ELECTRODE_LAYER_URL, nodes: [] };
    const updater = makeLayerMergeUpdater(layer, ELECTRODE_LAYER_URL);
    const prev = [OTHER, layer];
    expect(updater(prev)).toBe(prev); // data hasn't changed — same reference back
  });

  it('has layer + already present + different object: replaces it in place, preserving position', () => {
    const oldLayer = { url: ELECTRODE_LAYER_URL, nodes: [] };
    const newLayer = { url: ELECTRODE_LAYER_URL, nodes: [{ name: 'B1' }] };
    const updater = makeLayerMergeUpdater(newLayer, ELECTRODE_LAYER_URL);
    expect(updater([oldLayer, OTHER])).toEqual([newLayer, OTHER]); // position 0 preserved, not appended
  });
});

describe('makeSettingsMergeUpdater', () => {
  const OTHER_SETTINGS = { url: '/mri.nii', visible: true, opacity: 1 };

  it('no layer + not already present: no-op', () => {
    const updater = makeSettingsMergeUpdater(null, ELECTRODE_LAYER_URL);
    const prev = [OTHER_SETTINGS];
    expect(updater(prev)).toBe(prev);
  });

  it('no layer + already present: removes its settings entry', () => {
    const existingSettings = { url: ELECTRODE_LAYER_URL, visible: true, opacity: 0.6 };
    const updater = makeSettingsMergeUpdater(null, ELECTRODE_LAYER_URL);
    expect(updater([OTHER_SETTINGS, existingSettings])).toEqual([OTHER_SETTINGS]);
  });

  it('has layer + already present: leaves the existing settings entry untouched (a data-only refresh never overwrites user choices)', () => {
    const layer = { url: ELECTRODE_LAYER_URL, kind: 'connectome', nodes: [{ name: 'B1' }] };
    const existingSettings = { url: ELECTRODE_LAYER_URL, visible: false, opacity: 0.3 };
    const updater = makeSettingsMergeUpdater(layer, ELECTRODE_LAYER_URL);
    expect(updater([OTHER_SETTINGS, existingSettings])).toEqual([OTHER_SETTINGS, existingSettings]);
  });

  it('has layer + not already present: appends freshly-defaulted settings from getInitialLayerSettings', () => {
    const layer = { url: ELECTRODE_LAYER_URL, kind: 'connectome', nodes: [] };
    const updater = makeSettingsMergeUpdater(layer, ELECTRODE_LAYER_URL, undefined, 1);
    const result = updater([OTHER_SETTINGS]);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      url: ELECTRODE_LAYER_URL,
      visible: true,
      electrodeDisplayMode: 'none',
    });
  });

  it('seeds a first-appearance settings entry with the given currentMeshXRay rather than resetting to the default', () => {
    const layer = { url: ELECTRODE_LAYER_URL, kind: 'connectome', nodes: [] };
    const updater = makeSettingsMergeUpdater(layer, ELECTRODE_LAYER_URL, undefined, 0.4);
    const result = updater([]);
    expect(result[0].meshXRay).toBe(0.4);
  });
});
