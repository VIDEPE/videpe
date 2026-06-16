// EEG electrode positions on a unit sphere.
// Coordinate convention: x = right, y = front (nasion direction), z = up (vertex direction).
// All positions satisfy |pos| = 1.
//
// Three related systems — each is a strict superset of the previous:
//   POSITIONS_10_20  Jasper (1958)                  ~21 electrodes, 20% arc spacing
//   POSITIONS_10_10  extended 10-20 (ACNS standard)  ~64 electrodes, 10% arc spacing
//   POSITIONS_10_5   Oostenveld & Praamstra (2001)   ~345 electrodes,  5% arc spacing
//
// This file currently defines 10-20 and 10-10.
// 10-5 positions can be added as POSITIONS_10_5 = { ...POSITIONS_10_10, … } when needed.
//
// Coordinate derivation for on-axis electrodes:
//   θ = polar angle from vertex (Cz = 0°, ear equator = 90°)
//   φ = azimuthal from front, clockwise when viewed from above (front = 0°, right = 90°)
//   x = sin(θ)·sin(φ),  y = sin(θ)·cos(φ),  z = cos(θ)
//   Each 10% arc step = 18°, so Fz (30% from nasion) is 36° from vertex → z = cos 36° = 0.809

// ─── 10-20 system (~21 electrodes) ───────────────────────────────────────────
// The original international standard. Spacing = 20% of the nasion-to-inion arc.
export const POSITIONS_10_20 = {
  // Midline
  Fpz: { x: 0.0, y: 0.951, z: 0.309 }, // θ=72°
  Fz: { x: 0.0, y: 0.588, z: 0.809 }, // θ=36°
  Cz: { x: 0.0, y: 0.0, z: 1.0 }, // θ= 0° (vertex)
  Pz: { x: 0.0, y: -0.588, z: 0.809 }, // θ=36°, posterior
  Oz: { x: 0.0, y: -0.951, z: 0.309 }, // θ=72°, posterior

  // Fp row
  Fp1: { x: -0.309, y: 0.924, z: 0.221 },
  Fp2: { x: 0.309, y: 0.924, z: 0.221 },

  // F row (10-20 subset: F7/F3/F4/F8)
  F7: { x: -0.809, y: 0.588, z: 0.0 },
  F3: { x: -0.546, y: 0.676, z: 0.494 },
  F4: { x: 0.546, y: 0.676, z: 0.494 },
  F8: { x: 0.809, y: 0.588, z: 0.0 },

  // C row (10-20 subset: T7/C3/C4/T8 — T7/T8 were called T3/T4 in the original)
  T7: { x: -1.0, y: 0.0, z: 0.0 }, // θ=90° (left ear equator)
  C3: { x: -0.669, y: 0.0, z: 0.743 },
  C4: { x: 0.669, y: 0.0, z: 0.743 },
  T8: { x: 1.0, y: 0.0, z: 0.0 }, // θ=90° (right ear equator)

  // P row (10-20 subset: P7/P3/P4/P8 — P7/P8 were called T5/T6 in the original)
  P7: { x: -0.809, y: -0.588, z: 0.0 },
  P3: { x: -0.546, y: -0.676, z: 0.494 },
  P4: { x: 0.546, y: -0.676, z: 0.494 },
  P8: { x: 0.809, y: -0.588, z: 0.0 },

  // O row
  O1: { x: -0.309, y: -0.924, z: 0.221 },
  O2: { x: 0.309, y: -0.924, z: 0.221 },
};

// ─── 10-10 system (~64 electrodes) ───────────────────────────────────────────
// Extends 10-20 by inserting positions at every 10% arc step.
// Adds inter-row positions (AF, FC, TP, CP, PO rows) and lateral fill-ins
// (F1/F2/F5/F6, C1/C2/C5/C6, P1/P2/P5/P6, etc.).
// Also includes the sub-temporal chain (T9/T10, TP9/TP10, P9/P10) which sits
// 18° below the ear equator and appears in many HD-EEG caps.
export const POSITIONS_10_10 = {
  ...POSITIONS_10_20,

  // ── Additional midline positions ──────────────────────────────────────────
  AFz: { x: 0.0, y: 0.809, z: 0.588 }, // between Fpz and Fz
  FCz: { x: 0.0, y: 0.309, z: 0.951 }, // between Fz and Cz
  CPz: { x: 0.0, y: -0.309, z: 0.951 }, // between Cz and Pz
  POz: { x: 0.0, y: -0.809, z: 0.588 }, // between Pz and Oz

  // ── AF row ────────────────────────────────────────────────────────────────
  AF7: { x: -0.669, y: 0.743, z: 0.0 },
  AF3: { x: -0.362, y: 0.862, z: 0.353 },
  AF4: { x: 0.362, y: 0.862, z: 0.353 },
  AF8: { x: 0.669, y: 0.743, z: 0.0 },

  // ── Additional F row positions ────────────────────────────────────────────
  F5: { x: -0.736, y: 0.588, z: 0.338 },
  F1: { x: -0.277, y: 0.725, z: 0.633 },
  F2: { x: 0.277, y: 0.725, z: 0.633 },
  F6: { x: 0.736, y: 0.588, z: 0.338 },

  // ── FT row ────────────────────────────────────────────────────────────────
  FT7: { x: -0.974, y: 0.225, z: 0.0 },
  FT8: { x: 0.974, y: 0.225, z: 0.0 },

  // ── FC row ────────────────────────────────────────────────────────────────
  FC5: { x: -0.837, y: 0.409, z: 0.362 },
  FC3: { x: -0.584, y: 0.481, z: 0.654 },
  FC1: { x: -0.294, y: 0.477, z: 0.828 },
  FC2: { x: 0.294, y: 0.477, z: 0.828 },
  FC4: { x: 0.584, y: 0.481, z: 0.654 },
  FC6: { x: 0.837, y: 0.409, z: 0.362 },

  // ── Additional C row positions ────────────────────────────────────────────
  C5: { x: -0.891, y: 0.0, z: 0.454 },
  C1: { x: -0.331, y: 0.0, z: 0.944 },
  C2: { x: 0.331, y: 0.0, z: 0.944 },
  C6: { x: 0.891, y: 0.0, z: 0.454 },

  // ── TP row ────────────────────────────────────────────────────────────────
  TP7: { x: -0.974, y: -0.225, z: 0.0 },
  TP8: { x: 0.974, y: -0.225, z: 0.0 },

  // ── CP row ────────────────────────────────────────────────────────────────
  CP5: { x: -0.837, y: -0.409, z: 0.362 },
  CP3: { x: -0.584, y: -0.481, z: 0.654 },
  CP1: { x: -0.294, y: -0.477, z: 0.828 },
  CP2: { x: 0.294, y: -0.477, z: 0.828 },
  CP4: { x: 0.584, y: -0.481, z: 0.654 },
  CP6: { x: 0.837, y: -0.409, z: 0.362 },

  // ── Additional P row positions ────────────────────────────────────────────
  P5: { x: -0.736, y: -0.588, z: 0.338 },
  P1: { x: -0.277, y: -0.725, z: 0.633 },
  P2: { x: 0.277, y: -0.725, z: 0.633 },
  P6: { x: 0.736, y: -0.588, z: 0.338 },

  // ── PO row ────────────────────────────────────────────────────────────────
  PO7: { x: -0.669, y: -0.743, z: 0.0 },
  PO3: { x: -0.362, y: -0.862, z: 0.353 },
  PO4: { x: 0.362, y: -0.862, z: 0.353 },
  PO8: { x: 0.669, y: -0.743, z: 0.0 },

  // ── Sub-temporal chain (θ=108°, 18° below the ear equator) ───────────────
  // Common in HD-EEG caps; not part of the original 10-10 scalp-only set.
  T9: { x: -0.951, y: 0.0, z: -0.309 },
  T10: { x: 0.951, y: 0.0, z: -0.309 },
  TP9: { x: -0.847, y: -0.432, z: -0.309 },
  TP10: { x: 0.847, y: -0.432, z: -0.309 },
  P9: { x: -0.559, y: -0.769, z: -0.309 },
  P10: { x: 0.559, y: -0.769, z: -0.309 },

  // ── Legacy 10-20 name aliases ─────────────────────────────────────────────
  // T3/T4/T5/T6 were renamed to T7/T8/P7/P8 in the extended system.
  T3: { x: -1.0, y: 0.0, z: 0.0 },
  T4: { x: 1.0, y: 0.0, z: 0.0 },
  T5: { x: -0.809, y: -0.588, z: 0.0 },
  T6: { x: 0.809, y: -0.588, z: 0.0 },
};
