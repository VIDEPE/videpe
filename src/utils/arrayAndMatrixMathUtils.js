// Handy utilities for array and matrix operations => useful for EEG source imaging and other numerical computations
// Taken from: https://rikyperdana.medium.com/matrix-operations-in-functional-js-e3463f36b160

// sample1 = [
//   [1, 2],
//   [3, 4]
// ] // simple 2x2 matrix for testing

// sample2 = [
//   [1, 1, 1,-1],
//   [1, 1,-1, 1],
//   [1,-1, 1, 1],
//   [-1,1, 1, 1]
// ] // example from https://semath.info/src/inverse-cofactor-ex4.html

// sample3 = [
//   [1, 0, 4,-6],
//   [2, 5, 0, 3],
//   [-1,2, 3, 5],
//   [2, 1,-2, 3]
// ] // example from The Organic Chemistry - Determinant of 4x4 Matrix

export function withAs(obj, cb) {
  // pass object around in a purely expressive function
  return cb(obj);
}
// withAs('abc', str => str.toUpperCase()) // gets 'ABC'

export function sum(arr) {
  // sum any given array of numbers
  return arr.reduce((a, b) => a + b);
}
// sum([1, 2, 3]) // gets 6

export function mul(arr) {
  // multiply each given numbers in an array
  return arr.reduce((a, b) => a * b);
}
// mul([1, 2, 3]) // gets 6

export function sub(arr) {
  // substract each numbers against the first given
  return arr.slice(1).reduce((a, b) => a - b, arr[0]);
}
// sub([10, 2, 3]) // gets 5

export function deepClone(obj) {
  // when array spread syntax didn't work, this one will
  return JSON.parse(JSON.stringify(obj));
}
// deepClone(sample1) // gets [[1, 2], [3, 4]]

export function shift(arr, step) {
  // if an array is a ring, rotate leftwise in certain steps
  return [...arr.slice(step), ...arr.slice(0, step)];
}
// shift([1, 2, 3, 4], 1) // gets [2, 3, 4, 1]

export function makeArray(n, cb) {
  // create an array with certain length
  return [...Array(n).keys()].map((i) => (cb ? cb(i) : i));
}
// makeArray(5) // [0, 1, 2, 3, 4]

export function makeMatrix(len, wid, fill) {
  // create a matrix in any size, with customizable contents
  return makeArray(len).map((i) => makeArray(wid, (j) => (fill ? fill(i, j) : 0)));
}
// // Make a 3x3 identity matrix
// makeMatrix(3, 3, (i, j) => +(i === j))
// /* gets [
//   [1, 0, 0],
//   [0, 1, 0],
//   [0, 0, 1]
// ]*/

export function matrixRandom(len, wid, min = 0, max = 100) {
  // create a matrix in any size, with random numbers
  return makeMatrix(len, wid, (x) => Math.round(Math.random() * (max - min)) + min);
}
// matrixRandom(2, 3, -100)
// /* shall yield [
//   [41, -23,  0],
//   [-78, 10, 42]
// ]*/

export function matrixSize(matrix) {
  // yields the dimension of any given matrix
  return [matrix.length, matrix[0].length];
}

export function arrayToMatrix(len, wid, arr) {
  // convert a 1D array into a 2D matrix
  return makeArray(len).map((i) => arr.slice(i * wid, i * wid + wid));
}
// arrayToMatrix(2, 3, [1, 2, 3, 4, 5, 6])
// /* get [
//   [1, 2, 3],
//   [4, 5, 6]
// ]*/

export function matrixMap(matrix, cb) {
  // map a matrix with a callback function, with access to the original matrix
  return deepClone(matrix).map((i, ix) => i.map((j, jx) => cb({ i, ix, j, jx, matrix })));
}
// withAs('abcdefghijklmn', alph => matrixMap(
//   sample1, ({j}) => alph.split('')[j]
// )) // shall yield [['b', 'c'], ['d', 'e']]

export function matrixScalar(n, matrix) {
  // multiply each element in a matrix by a scalar
  return matrixMap(matrix, ({ j }) => n * j);
}
// matrixScalar(2, sample1)
// // shall yield [[2, 4], [6, 8]]

export function matrixAdd(matrices) {
  // matrixAdd([sample1, sample1])
  return matrices.reduce(
    (acc, inc) => matrixMap(acc, ({ j, ix, jx }) => j + inc[ix][jx]),
    makeMatrix(...matrixSize(matrices[0]))
  ); // add multiple matrices together
}
// matrixAdd([sample1, sample1, sample1])
// // shall yield [[3, 6], [9, 12]]

export function matrixSub(matrices) {
  // substract multiple matrices from the first one
  return matrices
    .slice(1)
    .reduce((acc, inc) => matrixMap(acc, ({ j, ix, jx }) => j - inc[ix][jx]), matrices[0]);
}
// matrixSub([sample1, sample1])
// // shall yield [[0, 0], [0, 0]]

export function matrixMul(m1, m2) {
  // multiply two matrices together
  return makeMatrix(m1.length, m2[0].length, (i, j) => sum(m1[i].map((k, kx) => k * m2[kx][j])));
}
// matrixMul(sample1, sample1)
// // shall yield [[7, 10], [15, 22]]

export function matrixMuls(matrices) {
  // multiply multiple matrices together
  return deepClone(matrices)
    .splice(1)
    .reduce(
      (acc, inc) =>
        makeMatrix(acc.length, inc[0].length, (ix, jx) =>
          sum(acc[ix].map((k, kx) => k * inc[kx][jx]))
        ),
      deepClone(matrices[0])
    );
}
// matrixMuls([
//   matrixRandom(3, 5),
//   matrixRandom(5, 3),
//   matrixRandom(3, 1)
// ]) // gets [[3722689], [3301757], [3720788]]

export function matrixTrans(matrix) {
  // transpose a matrix
  return makeMatrix(...shift(matrixSize(matrix), 1), (i, j) => matrix[j][i]);
}
// matrixTrans(sample1) // [[1, 3], [2, 4]]
// matrixTrans(sample3) /* shall yield [
//   [1, 2, -1, 2]
//   [0, 5, 2, 1]
//   [4, 0, 3, -2]
//   [-6, 3, 5, 3]
// ] */

export function matrixMinor(matrix, row, col) {
  // get the minor of a matrix, by removing a certain row and column
  return matrix.filter((i, ix) => ix !== row - 1).map((i) => i.filter((j, jx) => jx !== col - 1));
}
// matrixMinor(sample1, 1, 1)
// // shall yield [[4]]
// matrixMinor(sample3, 1, 1) /* shall yield [
//   [5, 0, 3]
//   [2, 3, 5]
//   [1,-2, 3]
// ]*/
// matrixMinor(sample3, 3, 3) /* shall yield [
//   [1, 0,-6]
//   [2, 5, 3]
//   [2, 1, 3]
// ]*/
// matrixMinor(
//   matrixMinor(sample3, 3, 3),
//   2, 2
// ) // shall yield [[1, -6], [2, 3]]

export function matrixDet(matrix) {
  // get the determinant of a matrix
  return withAs(deepClone(matrix), (clone) =>
    matrix.length < 3
      ? sub(matrixTrans(clone.map(shift)).map(mul))
      : sum(
          clone[0].map(
            (i, ix) => matrixDet(matrixMinor(matrix, 1, ix + 1)) * Math.pow(-1, ix + 2) * i
          )
        )
  );
}
// matrixDet(sample1) // get -2
// matrixDet(sample2) // get -16
// matrixDet(sample3) // get 318

export function matrixCofactor(matrix) {
  // get the cofactor of a matrix
  return matrixMap(matrix, ({ i, ix, j, jx }) =>
    matrix[0].length > 2
      ? Math.pow(-1, ix + jx + 2) * matrixDet(matrixMinor(matrix, ix + 1, jx + 1))
      : ix != jx
        ? -matrix[jx][ix]
        : matrix[+!ix][+!jx]
  );
}
// matrixCofactor(sample1) // shall yield [[4, -3], [-2, 1]]
// matrixCofactor(sample2) /* shall yield [
//   [-4, -4, -4, 4]
//   [-4, -4, 4, -4]
//   [-4, 4, -4, -4]
//   [4, -4, -4, -4]
// ]*/
// matrixCofactor(sample3) /* shall yield [
//   [ 74,-26, 52, -6]
//   [-38, 95,-31,-27]
//   [12, -30, 60, 42]
//   [166,-97, 35, 51]
// ]*/

export function matrixInverse(matrix) {
  // get the inverse of a matrix
  return matrixMap(matrixTrans(matrixCofactor(matrix)), ({ j }) => j / matrixDet(matrix));
}
// matrixInverse(sample1) // shall yield [[1, -1], [-1, 1]]
// matrixInverse(sample2) /* shall yield [
//   [0.25, 0.25, 0.25, -0.25]
//   [0.25, 0.25, -0.25, 0.25]
//   [0.25, -0.25, 0.25, 0.25]
//   [-0.25, 0.25, 0.25, 0.25]
// ]*/
// matrixInverse(sample3) /* shall yield [
//   [0.2327, -0.1194, 0.0377, 0.5220]
//   [-0.0817, 0.2987,-0.0943,-0.3050]
//   [0.1635, -0.0974, 0.1886, 0.1100]
//   [-0.0188,-0.0849, 0.1320, 0.1603]
// ]*/

export function matrixLinSolve(conds, res) {
  // solve a linear equation system, given the conditions and results
  // res [4x1] = conds [4x4] * return [4x1] — res and the return value are column vectors
  // mathematically, even though both are passed/returned here as flat arrays (rows) for convenience
  return matrixMul(
    matrixInverse(conds),
    res.map((i) => [i])
  ).map((i) => i[0]);
}
// matrixLinSolve(
//   [
//     [1, 0, 4,-6],
//     [2, 5, 0, 3],
//     [-1,2, 3, 5],
//     [2, 1,-2, 3]
//   ], [-12, 34, 41, 14]
// ) // correctly get [2, 3, 4, 5]

export function euclideanDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); // hypot returns square root of sum of squares
}
// euclideanDistance([3, 4, 5],[0, 0, 0]);
// Expected output: 7.0710678118654755

export function vectorSubtract(a, b) {
  // elementwise subtraction of two 3D points/vectors — not to be confused with sub(), which
  // subtracts a flat list of plain numbers sequentially
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
// vectorSubtract([5, 7, 9], [1, 2, 3]) // gets [4, 5, 6]

export function dotProduct(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
// dotProduct([1, 2, 3], [4, 5, 6]) // gets 32

export function crossProduct(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
// crossProduct([1, 0, 0], [0, 1, 0]) // gets [0, 0, 1]

export function vectorLength(v) {
  return Math.hypot(v[0], v[1], v[2]);
}
// vectorLength([3, 4, 0]) // gets 5

export function mean(arr) {
  return sum(arr) / arr.length;
}
// mean([1, 2, 3]) // gets 2

export function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b); // (a-b) => numeric sort, not lexicographic; [...v] => sort copy instead of the original vector
  const midIndex = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midIndex - 1] + sorted[midIndex]) / 2 // even-length: return average the two middle values
    : sorted[midIndex]; // odd-length: return the single middle value
}
// median([1,1,2]) // gets 1
