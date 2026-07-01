import { multiply } from 'mathjs';
import { matrixMuls, matrixRandom } from './arrayAndMatrixMathUtils.js';

const sample1 = [
  [1, 2],
  [3, 4],
];

// --- Test if both functions return the same output
const matrixMulsResult = matrixMuls([sample1, sample1]);
const mathjsMultiplyResult = multiply(sample1, sample1);
console.log('matrixMuls:', matrixMulsResult[0], matrixMulsResult[1]); // gets [[7, 10], [15, 22]]
console.log('mathjs multiply:', mathjsMultiplyResult[0], mathjsMultiplyResult[1]); // gets [[7, 10], [15, 22]]

// --- Benchmarks ---
// Run with: node src/utils/electricalSourceImagingUtils.js

// performance.now() is a global in Node 16+; if unavailable, swap for Date.now()
function timeit(label, fn, runs = 5) {
    // run a function multiple times and report the average execution time
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  const avg = times.reduce((a, b) => a + b, 0) / runs;
  console.log(`  ${label}: ${avg.toFixed(2)}ms avg over ${runs} runs`);
  return avg;
}

// --- Test 1: Scaling square matrix multiplication ---
// Both libraries multiply two NxN matrices; N grows from small to large to show
// where the performance curves diverge.
console.log('\n=== Test 1: Scaling NxN × NxN matrix multiplication ===');
for (const n of [4, 16, 32, 64, 128, 256, 512, 1024]) {
  const a = matrixRandom(n, n);
  const b = matrixRandom(n, n);
  console.log(`\n  ${n}×${n}:`);
  timeit('matrixMuls', () => matrixMuls([a, b]));
  timeit('mathjs multiply', () => multiply(a, b));
}

// --- Test 2: ESI hoth path — many repeated [3×Nchannels] × [Nchannels×1] multiplications ---
// Represents the core ESI loop: for each of ~4500 inside source points, multiply
// its [3 × Nchannels] inverse filter by the [Nchannels × 1] electrode voltage vector
// to get a [3 × 1] dipole moment, from which activation magnitude is computed.
const N_SOURCES = 4500;
const N_CHANNELS = 208;
const inverseFilters = matrixRandom(3, N_CHANNELS); // one source's filter (reused for all sources)
const channelVoltages = matrixRandom(N_CHANNELS, 1); // electrode voltages as column vector

console.log(`\n=== Test 2: ESI loop — ${N_SOURCES}× [3×${N_CHANNELS}] × [${N_CHANNELS}×1] ===`);
timeit(
  'matrixMuls',
  () => {
    for (let i = 0; i < N_SOURCES; i++) matrixMuls([inverseFilters, channelVoltages]);
  },
  3
);
timeit(
  'mathjs multiply',
  () => {
    for (let i = 0; i < N_SOURCES; i++) multiply(inverseFilters, channelVoltages);
  },
  3
);

// === Test 1: Scaling NxN × NxN matrix multiplication ===

//   4×4:
//   matrixMuls: 0.02ms avg over 5 runs
//   mathjs multiply: 0.05ms avg over 5 runs

//   16×16:
//   matrixMuls: 0.11ms avg over 5 runs
//   mathjs multiply: 0.17ms avg over 5 runs

//   64×64:
//   matrixMuls: 4.43ms avg over 5 runs
//   mathjs multiply: 1.87ms avg over 5 runs

//   128×128:
//   matrixMuls: 10.37ms avg over 5 runs
//   mathjs multiply: 6.74ms avg over 5 runs

//   256×256:
//   matrixMuls: 59.94ms avg over 5 runs
//   mathjs multiply: 48.93ms avg over 5 runs

//   512×512:
//   matrixMuls: 572.91ms avg over 5 runs
//   mathjs multiply: 438.50ms avg over 5 runs

//   1024×1024:
//   matrixMuls: 7626.80ms avg over 5 runs
//   mathjs multiply: 6803.93ms avg over 5 runs

//   2048×2048:
//   matrixMuls: 107905.10ms avg over 5 runs
//   mathjs multiply: 92820.53ms avg over 5 runs

// === Test 2: ESI loop — 4500× [3×208] × [208×1] ===
//   matrixMuls: 155.13ms avg over 3 runs
//   mathjs multiply: 133.60ms avg over 3 runs

// === Test 2: ESI loop — 12000× [3×208] × [208×1] ===
//   matrixMuls: 425.03ms avg over 3 runs
//   mathjs multiply: 343.32ms avg over 3 runs