// Shared EEG colormaps — used by EegTopoViewer's 3D mesh/markers, the intracranial
// matrix table, and the intracranial 3D connectome, so all three agree visually.

// Custom diverging colormap: blue (negative) -> white (zero) -> red (positive).
// (NiiVue's built-in 'blue2red' passes through green/yellow at the midpoint which is undesired)
export const EEG_TOPO_COLORMAP_KEY = 'eegBlueWhiteRed';
export const EEG_TOPO_COLORMAP = {
  R: [0, 255, 255],
  G: [0, 255, 0],
  B: [255, 255, 0],
  A: [255, 255, 255],
  I: [0, 128, 255],
};
export const EEG_TOPO_COLORMAP_COLOURBLIND_KEY = 'eegColourblind'; // cividis min and max values
export const EEG_TOPO_COLORMAP_COLOURBLIND = {
  R: [0, 255, 255],
  G: [32, 255, 233],
  B: [76, 255, 69],
  A: [255, 255, 255],
  I: [0, 128, 255],
};

// Electrode marker colormaps. NiiVue's connectome nodes pick one of two colormaps by the
// sign of colorValue (no single diverging option like mesh layers have), so each is one
// half — white at zero out to the saturated colour — of the mesh colormap above.
export const EEG_NODE_POS_KEY = 'eegNodePos';
export const EEG_NODE_POS = { R: [255, 255], G: [255, 0], B: [255, 0], A: [255, 255], I: [0, 255] };
export const EEG_NODE_NEG_KEY = 'eegNodeNeg';
export const EEG_NODE_NEG = { R: [255, 0], G: [255, 0], B: [255, 255], A: [255, 255], I: [0, 255] };
export const EEG_NODE_POS_COLOURBLIND_KEY = 'eegNodePosColourblind';
// White to Cividis yellow for positive voltage markers
export const EEG_NODE_POS_COLOURBLIND = {
  R: [255, 255],
  G: [255, 233],
  B: [255, 69],
  A: [255, 255],
  I: [0, 255],
};
// White to Cividis blue for negative voltage markers
export const EEG_NODE_NEG_COLOURBLIND_KEY = 'eegNodeNegColourblind';
export const EEG_NODE_NEG_COLOURBLIND = {
  R: [255, 0],
  G: [255, 32],
  B: [255, 76],
  A: [255, 255],
  I: [0, 255],
};
// Flat neutral grey for template electrodes with no recorded data at this site.
export const EEG_NODE_UNMAPPED_KEY = 'eegNodeUnmapped';
export const EEG_NODE_UNMAPPED = {
  R: [50, 50],
  G: [50, 50],
  B: [50, 50],
  A: [255, 255],
  I: [0, 255],
};

// White-point and saturated end-stops for the diverging scale above, expressed as plain
// RGB triples rather than NiiVue's 256-entry colormap format — used by interpolateDivergingColor
// for CSS rendering (matrix table cells) instead of GL textures.
const WHITE = { R: 255, G: 255, B: 255 };
const POSITIVE_END = { R: 255, G: 0, B: 0 };
const NEGATIVE_END = { R: 0, G: 0, B: 255 };
const POSITIVE_END_COLOURBLIND = { R: 255, G: 233, B: 69 };
const NEGATIVE_END_COLOURBLIND = { R: 0, G: 32, B: 76 };

// Interpolates a diverging blue-white-red (or cividis colourblind variant) CSS color
// for a voltage value, given the symmetric colormap range [-calMax, calMax].
// value=0 or calMax<=0 -> white.
export function interpolateDivergingColor(value, calMax, colourBlind = false) {
  if (!(calMax > 0)) return 'rgb(255, 255, 255)';

  const t = Math.max(-1, Math.min(1, value / calMax));
  const end =
    t >= 0
      ? colourBlind
        ? POSITIVE_END_COLOURBLIND
        : POSITIVE_END
      : colourBlind
        ? NEGATIVE_END_COLOURBLIND
        : NEGATIVE_END;
  const frac = Math.abs(t);

  const r = Math.round(WHITE.R + (end.R - WHITE.R) * frac);
  const g = Math.round(WHITE.G + (end.G - WHITE.G) * frac);
  const b = Math.round(WHITE.B + (end.B - WHITE.B) * frac);
  return `rgb(${r}, ${g}, ${b})`;
}
