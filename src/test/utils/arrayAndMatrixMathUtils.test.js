import { describe, it, expect } from 'vitest';
import {
  withAs,
  sum,
  mul,
  sub,
  deepClone,
  shift,
  makeArray,
  makeMatrix,
  matrixRandom,
  matrixSize,
  arrayToMatrix,
  matrixMap,
  matrixScalar,
  matrixAdd,
  matrixSub,
  matrixMul,
  matrixMuls,
  matrixTrans,
  matrixMinor,
  matrixDet,
  matrixCofactor,
  matrixInverse,
  matrixLinSolve,
  euclideanDistance,
  vectorSubtract,
  dotProduct,
  crossProduct,
  vectorLength,
  mean,
  median,
} from '@/utils/arrayAndMatrixMathUtils';

// ─── Fixtures ────────────────────────────────────────────────────────────────
// Same three sample matrices the source file's own comments are built around.

const sample1 = [
  [1, 2],
  [3, 4],
];

// example from https://semath.info/src/inverse-cofactor-ex4.html
const sample2 = [
  [1, 1, 1, -1],
  [1, 1, -1, 1],
  [1, -1, 1, 1],
  [-1, 1, 1, 1],
];

// example from The Organic Chemistry - Determinant of 4x4 Matrix
const sample3 = [
  [1, 0, 4, -6],
  [2, 5, 0, 3],
  [-1, 2, 3, 5],
  [2, 1, -2, 3],
];

// ─── withAs ──────────────────────────────────────────────────────────────────

describe('withAs', () => {
  it('passes the value through the callback and returns its result', () => {
    expect(withAs('abc', (str) => str.toUpperCase())).toBe('ABC');
  });
});

// ─── sum / mul / sub ─────────────────────────────────────────────────────────
//
// These three operate on a flat array of plain numbers — not to be confused with
// euclideanDistance/vectorSubtract/etc. below, which operate on 3D [x,y,z] points.

describe('sum', () => {
  it('adds every number in the array', () => {
    expect(sum([1, 2, 3])).toBe(6);
  });

  it('does not mutate its input', () => {
    const arr = [1, 2, 3];
    sum(arr);
    expect(arr).toEqual([1, 2, 3]);
  });
});

describe('mul', () => {
  it('multiplies every number in the array', () => {
    expect(mul([1, 2, 3])).toBe(6);
  });

  it('does not mutate its input', () => {
    const arr = [1, 2, 3];
    mul(arr);
    expect(arr).toEqual([1, 2, 3]);
  });
});

describe('sub', () => {
  it('subtracts every subsequent number from the first', () => {
    expect(sub([10, 2, 3])).toBe(5);
  });

  it('does not mutate its input', () => {
    const arr = [10, 2, 3];
    sub(arr);
    expect(arr).toEqual([10, 2, 3]);
  });
});

// ─── deepClone ───────────────────────────────────────────────────────────────

describe('deepClone', () => {
  it('returns a value-equal copy', () => {
    expect(deepClone(sample1)).toEqual(sample1);
  });

  it('returns a distinct object, not the same reference', () => {
    const clone = deepClone(sample1);
    expect(clone).not.toBe(sample1);
    expect(clone[0]).not.toBe(sample1[0]);
  });
});

// ─── shift ───────────────────────────────────────────────────────────────────

describe('shift', () => {
  it('rotates the array leftwise by the given number of steps', () => {
    expect(shift([1, 2, 3, 4], 1)).toEqual([2, 3, 4, 1]);
  });

  it('does not mutate its input', () => {
    const arr = [1, 2, 3, 4];
    shift(arr, 1);
    expect(arr).toEqual([1, 2, 3, 4]);
  });
});

// ─── makeArray ───────────────────────────────────────────────────────────────

describe('makeArray', () => {
  it('creates an array of indices when no callback is given', () => {
    expect(makeArray(5)).toEqual([0, 1, 2, 3, 4]);
  });

  it('maps each index through the given callback', () => {
    expect(makeArray(3, (i) => i * 10)).toEqual([0, 10, 20]);
  });
});

// ─── makeMatrix ──────────────────────────────────────────────────────────────

describe('makeMatrix', () => {
  it('creates a matrix of the given size filled with zeros by default', () => {
    expect(makeMatrix(2, 3)).toEqual([
      [0, 0, 0],
      [0, 0, 0],
    ]);
  });

  it('fills each cell via the given callback, indexed by (row, col)', () => {
    expect(makeMatrix(3, 3, (i, j) => +(i === j))).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });
});

// ─── matrixRandom ────────────────────────────────────────────────────────────
//
// Output is random by design — assert shape and bounds, not exact values.

describe('matrixRandom', () => {
  it('creates a matrix of the requested dimensions', () => {
    const m = matrixRandom(2, 3);
    expect(m).toHaveLength(2);
    expect(m[0]).toHaveLength(3);
    expect(m[1]).toHaveLength(3);
  });

  it('fills every cell within the given [min, max] range', () => {
    const m = matrixRandom(5, 5, -10, 10);
    for (const row of m) {
      for (const value of row) {
        expect(value).toBeGreaterThanOrEqual(-10);
        expect(value).toBeLessThanOrEqual(10);
      }
    }
  });
});

// ─── matrixSize ──────────────────────────────────────────────────────────────

describe('matrixSize', () => {
  it('returns [rows, cols] for a square matrix', () => {
    expect(matrixSize(sample1)).toEqual([2, 2]);
  });

  it('returns [rows, cols] for a non-square matrix', () => {
    expect(
      matrixSize([
        [1, 2, 3],
        [4, 5, 6],
      ])
    ).toEqual([2, 3]);
  });
});

// ─── arrayToMatrix ───────────────────────────────────────────────────────────

describe('arrayToMatrix', () => {
  it('converts a flat 1D array into a 2D matrix of the given shape', () => {
    expect(arrayToMatrix(2, 3, [1, 2, 3, 4, 5, 6])).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });
});

// ─── matrixMap ───────────────────────────────────────────────────────────────

describe('matrixMap', () => {
  it('maps every cell through the given callback', () => {
    expect(matrixMap(sample1, ({ j }) => j * 2)).toEqual([
      [2, 4],
      [6, 8],
    ]);
  });

  it('does not mutate the original matrix', () => {
    const original = deepClone(sample1);
    matrixMap(sample1, ({ j }) => j * 2);
    expect(sample1).toEqual(original);
  });
});

// ─── matrixScalar ────────────────────────────────────────────────────────────

describe('matrixScalar', () => {
  it('multiplies every cell by the given scalar', () => {
    expect(matrixScalar(2, sample1)).toEqual([
      [2, 4],
      [6, 8],
    ]);
  });
});

// ─── matrixAdd ───────────────────────────────────────────────────────────────

describe('matrixAdd', () => {
  it('adds two matrices together elementwise', () => {
    expect(matrixAdd([sample1, sample1])).toEqual([
      [2, 4],
      [6, 8],
    ]);
  });

  it('adds three or more matrices together elementwise', () => {
    expect(matrixAdd([sample1, sample1, sample1])).toEqual([
      [3, 6],
      [9, 12],
    ]);
  });
});

// ─── matrixSub ───────────────────────────────────────────────────────────────

describe('matrixSub', () => {
  it('subtracts the remaining matrices from the first, elementwise', () => {
    expect(matrixSub([sample1, sample1])).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  it('does not mutate its input array', () => {
    const matrices = [sample1, sample1];
    matrixSub(matrices);
    expect(matrices).toHaveLength(2);
  });
});

// ─── matrixMul ───────────────────────────────────────────────────────────────

describe('matrixMul', () => {
  it('multiplies two matrices together', () => {
    expect(matrixMul(sample1, sample1)).toEqual([
      [7, 10],
      [15, 22],
    ]);
  });
});

// ─── matrixMuls ──────────────────────────────────────────────────────────────

describe('matrixMuls', () => {
  it('agrees with matrixMul for exactly two matrices', () => {
    expect(matrixMuls([sample1, sample1])).toEqual(matrixMul(sample1, sample1));
  });

  it('multiplies a chain of more than two matrices together', () => {
    const identity = makeMatrix(2, 2, (i, j) => +(i === j));
    expect(matrixMuls([sample1, identity, identity])).toEqual(sample1);
  });

  it('does not mutate its input array (deep-clones before consuming it)', () => {
    const matrices = [sample1, sample1];
    matrixMuls(matrices);
    expect(matrices).toHaveLength(2);
  });
});

// ─── matrixTrans ─────────────────────────────────────────────────────────────

describe('matrixTrans', () => {
  it('transposes a square matrix', () => {
    expect(matrixTrans(sample1)).toEqual([
      [1, 3],
      [2, 4],
    ]);
  });

  it('transposes a 4×4 matrix', () => {
    expect(matrixTrans(sample3)).toEqual([
      [1, 2, -1, 2],
      [0, 5, 2, 1],
      [4, 0, 3, -2],
      [-6, 3, 5, 3],
    ]);
  });
});

// ─── matrixMinor ─────────────────────────────────────────────────────────────

describe('matrixMinor', () => {
  it('removes the given row and column from a 2×2 matrix, leaving a 1×1 matrix', () => {
    expect(matrixMinor(sample1, 1, 1)).toEqual([[4]]);
  });

  it('does not mutate its input, and does not alias it either (returns a fresh matrix)', () => {
    const original = deepClone(sample1);
    const result = matrixMinor(sample1, 1, 1);
    expect(sample1).toEqual(original);
    expect(result).not.toBe(sample1);
  });

  it('removes the given row and column from a 4×4 matrix', () => {
    expect(matrixMinor(sample3, 1, 1)).toEqual([
      [5, 0, 3],
      [2, 3, 5],
      [1, -2, 3],
    ]);
  });

  it('removes a different row/col pair correctly', () => {
    expect(matrixMinor(sample3, 3, 3)).toEqual([
      [1, 0, -6],
      [2, 5, 3],
      [2, 1, 3],
    ]);
  });

  it('can be applied twice in a row to shrink a matrix by two dimensions', () => {
    expect(matrixMinor(matrixMinor(sample3, 3, 3), 2, 2)).toEqual([
      [1, -6],
      [2, 3],
    ]);
  });
});

// ─── matrixDet ───────────────────────────────────────────────────────────────

describe('matrixDet', () => {
  it('computes the determinant of a 2×2 matrix', () => {
    expect(matrixDet(sample1)).toBe(-2);
  });

  it('computes the determinant of a 4×4 matrix (sample2)', () => {
    expect(matrixDet(sample2)).toBe(-16);
  });

  it('computes the determinant of a 4×4 matrix (sample3)', () => {
    expect(matrixDet(sample3)).toBe(318);
  });
});

// ─── matrixCofactor ──────────────────────────────────────────────────────────

describe('matrixCofactor', () => {
  it('computes the cofactor matrix of a 2×2 matrix', () => {
    expect(matrixCofactor(sample1)).toEqual([
      [4, -3],
      [-2, 1],
    ]);
  });

  it('computes the cofactor matrix of a 4×4 matrix (sample2)', () => {
    expect(matrixCofactor(sample2)).toEqual([
      [-4, -4, -4, 4],
      [-4, -4, 4, -4],
      [-4, 4, -4, -4],
      [4, -4, -4, -4],
    ]);
  });

  it('computes the cofactor matrix of a 4×4 matrix (sample3)', () => {
    expect(matrixCofactor(sample3)).toEqual([
      [74, -26, 52, -6],
      [-38, 95, -31, -27],
      [12, -30, 60, 42],
      [166, -97, 35, 51],
    ]);
  });
});

// ─── matrixInverse ───────────────────────────────────────────────────────────

describe('matrixInverse', () => {
  it('computes the inverse of a 2×2 matrix', () => {
    // det(sample1) = -2; inverse = 1/det * [[d,-b],[-c,a]] = [[-2,1],[1.5,-0.5]]
    expect(matrixInverse(sample1)).toEqual([
      [-2, 1],
      [1.5, -0.5],
    ]);
  });

  it('computes the inverse of a 4×4 matrix (sample2)', () => {
    expect(matrixInverse(sample2)).toEqual([
      [0.25, 0.25, 0.25, -0.25],
      [0.25, 0.25, -0.25, 0.25],
      [0.25, -0.25, 0.25, 0.25],
      [-0.25, 0.25, 0.25, 0.25],
    ]);
  });

  it('multiplying a matrix by its own inverse yields the identity matrix', () => {
    const identity = matrixMul(sample3, matrixInverse(sample3));
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        expect(identity[i][j]).toBeCloseTo(i === j ? 1 : 0, 5);
      }
    }
  });
});

// ─── matrixLinSolve ──────────────────────────────────────────────────────────

describe('matrixLinSolve', () => {
  it('solves a linear system for x, given the coefficient matrix and results vector', () => {
    const [x1, x2, x3, x4] = matrixLinSolve(sample3, [-12, 34, 41, 14]);
    expect(x1).toBeCloseTo(2, 5);
    expect(x2).toBeCloseTo(3, 5);
    expect(x3).toBeCloseTo(4, 5);
    expect(x4).toBeCloseTo(5, 5);
  });
  // Example for Electrical Source Imaging: mapPositionsToGridIndices needs to solve
  // offset = i*b1 + j*b2 + k*b3 for (i,j,k) — any source point can be reached from the anchor
  // by taking an integer number of steps along each basis direction.
  // e.g. if b1=[2,0,0], b2=[0,2,0], b3=[0,0,2] (a simple axis-aligned 2mm grid) and a point's
  // offset from the anchor is [4,2,6], then i·[2,0,0] + j·[0,2,0] + k·[0,0,2] = [4,2,6]
  // gives i=2, j=1, k=3 — 2 steps along b1, 1 along b2, 3 along b3.
  //
  // That simple axis-aligned example can't be used to test whether matrixLinSolve's `conds`
  // needs basis vectors as rows or as columns, though: it's a diagonal matrix, and a diagonal
  // matrix is its own transpose, so stacking b1/b2/b3 as rows or as columns of `conds` produces
  // the exact same matrix either way — the test would pass regardless of which orientation
  // matrixLinSolve actually expects.
  // A rotated basis breaks that symmetry (B ≠ Bᵀ), so only the correct orientation gives the
  // right answer — which is why this test uses one instead.
  it('solves a linear system with a non-symmetric (rotated) basis to determine whether conds needs basis vectors as rows or columns', () => {
    // b1/b2/b3 don't need to be a real rotated grid basis — matrixLinSolve just needs B=[b1,b2,b3]
    // to be asymmetric (B ≠ Bᵀ, so row vs. column orientation actually matters) and invertible
    // (det(B) ≠ 0, so a solution exists). These simple values satisfy both.
    const b1 = [4, 2.5, 0];
    const b2 = [-2.5, 4, 0];
    const b3 = [0, 0, 5];

    // offset = i*b1 + j*b2 + k*b3, chosen with i=2, j=-1, k=3 (negative j exercises sign handling too)
    const offset = [10.5, 1, 15];

    // "offset = i*b1 + j*b2 + k*b3" is the standard linear-algebra shape "M * x = offset" where M's
    // COLUMNS are the basis vectors b1, b2, b3 (not its rows) — multiplying a matrix by a vector gives
    // a linear combination of the matrix's columns, weighted by the vector's entries.
    // matrixTrans([b1, b2, b3]) turns the natural row-stack of the three basis vectors into the
    // column-stack matrixLinSolve's `conds` argument actually needs.
    const conds = matrixTrans([b1, b2, b3]);
    const [i, j, k] = matrixLinSolve(conds, offset);

    expect(i).toBeCloseTo(2, 5);
    expect(j).toBeCloseTo(-1, 5);
    expect(k).toBeCloseTo(3, 5);

    // Conclusion for mapPositionsToGridIndices: when solving offset = i*b1 + j*b2 + k*b3 for (i,j,k),
    // pass matrixTrans([b1, b2, b3]) as `conds`, not [b1, b2, b3] directly.
  });
});

// ─── euclideanDistance / vectorSubtract / dotProduct / crossProduct / vectorLength ──
//
// These operate on 3D [x, y, z] points/vectors — distinct from sum/mul/sub above,
// which operate on flat arrays of plain numbers.

describe('euclideanDistance', () => {
  it('computes the straight-line distance between two 3D points', () => {
    expect(euclideanDistance([3, 4, 5], [0, 0, 0])).toBeCloseTo(7.0710678118654755, 10);
  });

  it('returns 0 for two identical points', () => {
    expect(euclideanDistance([1, 2, 3], [1, 2, 3])).toBe(0);
  });
});

describe('vectorSubtract', () => {
  it('subtracts two 3D points elementwise', () => {
    expect(vectorSubtract([5, 7, 9], [1, 2, 3])).toEqual([4, 5, 6]);
  });

  it('does not mutate either input', () => {
    const a = [5, 7, 9];
    const b = [1, 2, 3];
    vectorSubtract(a, b);
    expect(a).toEqual([5, 7, 9]);
    expect(b).toEqual([1, 2, 3]);
  });
});

describe('dotProduct', () => {
  it('computes the dot product of two 3D vectors', () => {
    expect(dotProduct([1, 2, 3], [4, 5, 6])).toBe(32);
  });

  it('returns 0 for perpendicular unit vectors', () => {
    expect(dotProduct([1, 0, 0], [0, 1, 0])).toBe(0);
  });
});

describe('crossProduct', () => {
  it('computes the cross product of two 3D vectors', () => {
    expect(crossProduct([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
  });

  it('returns the zero vector for two parallel vectors', () => {
    expect(crossProduct([2, 4, 6], [1, 2, 3])).toEqual([0, 0, 0]);
  });
});

describe('vectorLength', () => {
  it('computes the magnitude of a 3D vector', () => {
    expect(vectorLength([3, 4, 0])).toBe(5);
  });

  it('returns 0 for the zero vector', () => {
    expect(vectorLength([0, 0, 0])).toBe(0);
  });
});

// ─── mean ────────────────────────────────────────────────────────────────────

describe('mean', () => {
  it('computes the arithmetic mean of an array of numbers', () => {
    expect(mean([1, 2, 3])).toBe(2);
  });

  it('returns the single value for a 1-element array', () => {
    expect(mean([42])).toBe(42);
  });

  it('does not mutate its input', () => {
    const arr = [1, 2, 3];
    mean(arr);
    expect(arr).toEqual([1, 2, 3]);
  });

  it('is pulled toward an outlier, unlike median', () => {
    expect(mean([1, 2, 3, 1000])).toBe(251.5);
  });
});

// ─── median ──────────────────────────────────────────────────────────────────

describe('median', () => {
  it('returns the middle value for an odd-length array', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two middle values for an even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('returns the single value for a 1-element array', () => {
    expect(median([42])).toBe(42);
  });

  it('does not mutate its input (sorts a copy)', () => {
    const arr = [3, 1, 2];
    median(arr);
    expect(arr).toEqual([3, 1, 2]);
  });

  it('is robust to an outlier', () => {
    expect(median([1, 2, 3, 1000])).toBe(2.5);
  });
});
