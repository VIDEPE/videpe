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
  getCalBounds,
  fractionToCalValue,
  isAnyColorbarActive,
  makeRandomColormap,
  applyColormap,
  MAX_RANDOM_COLORMAP_LABELS,
  ESI_LAYER_URL,
  computeAzimuthElevation,
  rotateViews,
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

  it('reads global_min/global_max off the NVImage when the colormap is random', () => {
    const layer = { url: 'blob:atlas' };
    const nvVolume = { robust_min: 10, robust_max: 200, global_min: 0, global_max: 115 };
    expect(getCalBounds(layer, nvVolume, 'randomised')).toEqual({ boundMin: 0, boundMax: 115 });
  });

  it('defaults to 0/1 for a random colormap when nvVolume is missing', () => {
    const layer = { url: 'blob:atlas' };
    expect(getCalBounds(layer, undefined, 'randomised')).toEqual({ boundMin: 0, boundMax: 1 });
  });

  it('still uses the ESI layer bounds even if its colormap happens to be random', () => {
    const layer = { url: ESI_LAYER_URL, boundMin: 2, boundMax: 20 };
    const nvVolume = { global_min: 0, global_max: 999 };
    expect(getCalBounds(layer, nvVolume, 'randomised')).toEqual({ boundMin: 2, boundMax: 20 });
  });
});

describe('makeRandomColormap', () => {
  it('returns 256 R/G/B/I entries with I as the identity 0-255 sequence', () => {
    const cmap = makeRandomColormap(0, 5);
    expect(cmap.R).toHaveLength(MAX_RANDOM_COLORMAP_LABELS);
    expect(cmap.G).toHaveLength(MAX_RANDOM_COLORMAP_LABELS);
    expect(cmap.B).toHaveLength(MAX_RANDOM_COLORMAP_LABELS);
    expect(cmap.I).toEqual(Array.from({ length: 256 }, (_, i) => i));
  });

  it('keeps every color channel within the 0-255 byte range', () => {
    const cmap = makeRandomColormap(0, 5);
    for (const channel of [cmap.R, cmap.G, cmap.B]) {
      for (const value of channel) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(255);
      }
    }
  });

  it('gives every LUT slot belonging to the same label an identical color', () => {
    // minIndex=0, maxIndex=1 => slots 0-127 round to label 0, slots 128-255 round to label 1
    // (Math.round(lutSlot / 255) crosses from 0 to 1 at lutSlot 128).
    const cmap = makeRandomColormap(0, 1);
    const colorAt = (i) => [cmap.R[i], cmap.G[i], cmap.B[i]];
    expect(colorAt(0)).toEqual(colorAt(127));
    expect(colorAt(128)).toEqual(colorAt(255));
  });

  it('gives different labels different colors', () => {
    const randomSpy = vi.spyOn(Math, 'random');
    randomSpy.mockReturnValueOnce(0).mockReturnValueOnce(0.5); // distinct hues for label 0 and label 1
    const cmap = makeRandomColormap(0, 1);
    randomSpy.mockRestore();
    expect([cmap.R[0], cmap.G[0], cmap.B[0]]).not.toEqual([cmap.R[255], cmap.G[255], cmap.B[255]]);
  });
});

describe('applyColormap', () => {
  it('registers a per-volume named colormap and selects it when the colormap is random', () => {
    const nv = { addColormap: vi.fn(), setColormap: vi.fn() };
    const nvVolume = { id: 'vol-1', global_min: 0, global_max: 5 };

    applyColormap(nv, nvVolume, 'randomised');

    expect(nv.addColormap).toHaveBeenCalledTimes(1);
    const [key, cmap] = nv.addColormap.mock.calls[0];
    expect(key).toBe('randomised-vol-1');
    expect(cmap.R).toHaveLength(MAX_RANDOM_COLORMAP_LABELS);
    expect(nv.setColormap).toHaveBeenCalledWith('vol-1', key);
  });

  it('gives each volume its own colormap key', () => {
    const nv = { addColormap: vi.fn(), setColormap: vi.fn() };
    applyColormap(nv, { id: 'vol-1', global_min: 0, global_max: 5 }, 'randomised');
    applyColormap(nv, { id: 'vol-2', global_min: 0, global_max: 5 }, 'randomised');
    expect(nv.addColormap.mock.calls[0][0]).toBe('randomised-vol-1');
    expect(nv.addColormap.mock.calls[1][0]).toBe('randomised-vol-2');
  });

  it('passes a real colormap name straight through without registering anything', () => {
    const nv = { addColormap: vi.fn(), setColormap: vi.fn() };
    const nvVolume = { id: 'vol-1' };

    applyColormap(nv, nvVolume, 'viridis');

    expect(nv.addColormap).not.toHaveBeenCalled();
    expect(nv.setColormap).toHaveBeenCalledWith('vol-1', 'viridis');
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

describe('computeAzimuthElevation', () => {
  // NiiVue azimuths wrap around (-270 and 90 are the same camera position) — fold into
  // [0, 360) so the expectations below can use NiiVue's canonical values.
  const normalizeAzi = (azi) => ((azi % 360) + 360) % 360;

  // NiiVue convention: azimuth 0/90/180/270 puts the camera behind/left/in front/right of the
  // head, elevation 90 puts it above. Each point must land the camera on its own side.
  it.each([
    ['posterior', [0, -50, 0], 0],
    ['left', [-50, 0, 0], 90],
    ['anterior', [0, 50, 0], 180],
    ['right', [50, 0, 0], 270],
  ])('points the camera at a %s position from that side', (_, pos, expectedAzi) => {
    const [azi, elev] = computeAzimuthElevation(pos);
    expect(normalizeAzi(azi)).toBeCloseTo(expectedAzi);
    expect(elev).toBeCloseTo(0);
  });

  it('raises the camera to 90° elevation for a position straight above', () => {
    expect(computeAzimuthElevation([0, 0, 50])[1]).toBeCloseTo(90);
  });

  it('lowers the camera to -90° elevation for a position straight below', () => {
    expect(computeAzimuthElevation([0, 0, -50])[1]).toBeCloseTo(-90);
  });

  it('tilts the camera 45° up for a position as high as it is far out horizontally', () => {
    const [azi, elev] = computeAzimuthElevation([-30, 0, 30]);
    expect(normalizeAzi(azi)).toBeCloseTo(90);
    expect(elev).toBeCloseTo(45);
  });

  // NiiVue rotates the 3D render around nv.pivot3D — the centre of the scene's bounding box —
  // not around the mm origin. A scan whose origin isn't at the centre of the head (e.g. MNI, where
  // the brain's centre is roughly [0, -20, 20], or native scanner space) must still get the
  // camera on the point's side as seen from that pivot.
  describe('with a pivot away from the origin', () => {
    const PIVOT = [0, -20, 20];

    it('points the camera from the left at a position directly left of the pivot', () => {
      // Seen from the origin this point is left, posterior and up (~22° azimuth off, ~20° up).
      const [azi, elev] = computeAzimuthElevation([-50, -20, 20], PIVOT);
      expect(normalizeAzi(azi)).toBeCloseTo(90);
      expect(elev).toBeCloseTo(0);
    });

    it('points the camera from behind at a position directly behind the pivot', () => {
      // Seen from the origin this point is behind but ~16° up, and [0, 0, 20] would even be in front.
      const [azi, elev] = computeAzimuthElevation([0, -90, 20], PIVOT);
      expect(normalizeAzi(azi)).toBeCloseTo(0);
      expect(elev).toBeCloseTo(0);
    });

    it('raises the camera to 90° elevation for a position straight above the pivot', () => {
      const [, elev] = computeAzimuthElevation([0, -20, 70], PIVOT);
      expect(elev).toBeCloseTo(90);
    });
  });

  it('treats an undefined pivot as the origin', () => {
    // nv.pivot3D is only set once NiiVue has drawn a 3D scene — before that the call site passes
    // undefined, which must fall back to the origin rather than throw.
    expect(computeAzimuthElevation([-50, 10, 30], undefined)).toEqual(
      computeAzimuthElevation([-50, 10, 30], [0, 0, 0])
    );
  });
});

describe('rotateViews', () => {
  // Stand-in for a Niivue instance — only what rotateViews touches.
  const makeView = (pivot3D) => ({ pivot3D, setRenderAzimuthElevation: vi.fn() });
  const POSITION = [-50, -20, 20];

  it('rotates every view to the same azimuth/elevation, so the views stay aligned', () => {
    const nvA = makeView([0, -20, 20]);
    const nvB = makeView([0, -20, 20]);

    rotateViews([nvA, nvB], POSITION);

    const [azi, elev] = computeAzimuthElevation(POSITION, [0, -20, 20]);
    expect(nvA.setRenderAzimuthElevation).toHaveBeenCalledWith(azi, elev);
    expect(nvB.setRenderAzimuthElevation).toHaveBeenCalledWith(azi, elev);
  });

  it('takes the pivot from the first view, even when the others have a different one', () => {
    // Both views share one rotation, so they can't each use their own pivot — the caller
    // lists the view with the most reliable pivot first.
    const nvA = makeView([0, -20, 20]);
    const nvB = makeView([10, 10, 10]);

    rotateViews([nvA, nvB], POSITION);

    const [azi, elev] = computeAzimuthElevation(POSITION, [0, -20, 20]);
    expect(nvB.setRenderAzimuthElevation).toHaveBeenCalledWith(azi, elev);
  });

  it('takes the pivot from the next view when the first has none yet', () => {
    // nv.pivot3D is only set once NiiVue has drawn a 3D scene
    const nvA = makeView(undefined);
    const nvB = makeView([0, -20, 20]);

    rotateViews([nvA, nvB], POSITION);

    const [azi, elev] = computeAzimuthElevation(POSITION, [0, -20, 20]);
    expect(nvA.setRenderAzimuthElevation).toHaveBeenCalledWith(azi, elev);
  });

  it('rotates around the origin when no view has a pivot yet', () => {
    const nvA = makeView(undefined);

    rotateViews([nvA], POSITION);

    expect(nvA.setRenderAzimuthElevation).toHaveBeenCalledWith(
      ...computeAzimuthElevation(POSITION)
    );
  });

  it('skips missing views (e.g. a topography view that was never created)', () => {
    const nvA = makeView([0, -20, 20]);

    expect(() => rotateViews([null, nvA, undefined], POSITION)).not.toThrow();
    expect(nvA.setRenderAzimuthElevation).toHaveBeenCalledTimes(1);
  });
});
