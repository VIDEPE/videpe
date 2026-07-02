import { multiply } from 'mathjs';
import { matrixMul, matrixMuls, matrixRandom } from './arrayAndMatrixMathUtils.js';

const sample1 = [
  [1, 2],
  [3, 4],
];

// --- Test if both functions return the same output
const matrixMulResult = matrixMul(sample1, sample1);
const matrixMulsResult = matrixMuls([sample1, sample1]);
const mathjsMultiplyResult = multiply(sample1, sample1);
console.log('matrixMul:', matrixMulResult[0], matrixMulResult[1]); // gets [[7, 10], [15, 22]]
console.log('matrixMuls:', matrixMulsResult[0], matrixMulsResult[1]); // gets [[7, 10], [15, 22]]
console.log('mathjs multiply:', mathjsMultiplyResult[0], mathjsMultiplyResult[1]); // gets [[7, 10], [15, 22]]

// --- Benchmarks ---
// Run with: node src/utils/electricalSourceImagingUtils.js

// performance.now() is a global in Node 16+; if unavailable, swap for Date.now()
function timeit(label, fn, runs = 10) {
  // run a function multiple times and report the median execution time
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  const sorted = times.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  console.log(`  ${label}: ${median.toFixed(2)}ms median over ${runs} runs`);
  return median;
}

// --- Test 1: Scaling square matrix multiplication ---
// Both libraries multiply two NxN matrices; N grows from small to large to show
// where the performance curves diverge.
console.log('\n=== Test 1: Scaling NxN × NxN matrix multiplication ===');
for (const n of [4, 16, 32, 64, 128, 256, 512]) {
  const a = matrixRandom(n, n);
  const b = matrixRandom(n, n);
  console.log(`\n  ${n}×${n}:`);
  timeit('matrixMul', () => matrixMul(a, b));
  timeit('matrixMuls', () => matrixMuls([a, b]));
  timeit('mathjs multiply', () => multiply(a, b));
}

// --- Test 2: ESI hoth path — many repeated [3×Nchannels] × [Nchannels×1] multiplications ---
// Represents the core ESI loop: for each of ~4500 inside source points, multiply
// its [3 × Nchannels] inverse filter by the [Nchannels × 1] electrode voltage vector
// to get a [3 × 1] dipole moment, from which activation magnitude is computed.
let N_SOURCES = 4500;
const N_CHANNELS = 208;
const inverseFilters = matrixRandom(3, N_CHANNELS); // one source's filter (reused for all sources)
const channelVoltages = matrixRandom(N_CHANNELS, 1); // electrode voltages as column vector

console.log(`\n=== Test 2: ESI loop — ${N_SOURCES}× [3×${N_CHANNELS}] × [${N_CHANNELS}×1] ===`);
timeit(
  'matrixMul',
  () => {
    for (let i = 0; i < N_SOURCES; i++) matrixMul(inverseFilters, channelVoltages);
  },
  5
);
timeit(
  'matrixMuls',
  () => {
    for (let i = 0; i < N_SOURCES; i++) matrixMuls([inverseFilters, channelVoltages]);
  },
  5
);
timeit(
  'mathjs multiply',
  () => {
    for (let i = 0; i < N_SOURCES; i++) multiply(inverseFilters, channelVoltages);
  },
  5
);
// Test again with a larger number of sources to see how the performance scales
N_SOURCES = 12000;
console.log(`\n=== Test 2: ESI loop — ${N_SOURCES}× [3×${N_CHANNELS}] × [${N_CHANNELS}×1] ===`);
timeit(
  'matrixMul',
  () => {
    for (let i = 0; i < N_SOURCES; i++) matrixMul(inverseFilters, channelVoltages);
  },
  5
);
timeit(
  'matrixMuls',
  () => {
    for (let i = 0; i < N_SOURCES; i++) matrixMuls([inverseFilters, channelVoltages]);
  },
  5
);
timeit(
  'mathjs multiply',
  () => {
    for (let i = 0; i < N_SOURCES; i++) multiply(inverseFilters, channelVoltages);
  },
  5
);

// --- Test 3: Flat Float64Array — single pass, full 64-bit precision ---
// Same algorithm as Test 4 below but using Float64Array (JS's native number precision).
// Isolates whether the speedup comes from the flat-array access pattern itself,
// independent of the float32 vs float64 precision difference.
const N_SOURCES_F64 = 4500;
const filtersF64 = new Float64Array(N_SOURCES_F64 * 3 * N_CHANNELS);
for (let s = 0; s < N_SOURCES_F64; s++) {
  for (let row = 0; row < 3; row++) {
    for (let c = 0; c < N_CHANNELS; c++) {
      filtersF64[s * 3 * N_CHANNELS + row * N_CHANNELS + c] = inverseFilters[row][c];
    }
  }
}
const voltagesF64 = new Float64Array(channelVoltages.map((row) => row[0]));
const activationsF64 = new Float64Array(N_SOURCES_F64);

function computeActivationsF64(filterData, voltages, nSources, nChannels, result) {
  for (let s = 0; s < nSources; s++) {
    const base = s * 3 * nChannels;
    let mx = 0,
      my = 0,
      mz = 0;
    for (let c = 0; c < nChannels; c++) {
      const v = voltages[c];
      mx += filterData[base + c] * v;
      my += filterData[base + nChannels + c] * v;
      mz += filterData[base + 2 * nChannels + c] * v;
    }
    result[s] = Math.sqrt(mx * mx + my * my + mz * mz);
  }
}

console.log(
  `\n=== Test 3: Flat Float64Array — ${N_SOURCES_F64}× [3×${N_CHANNELS}] × [${N_CHANNELS}×1] ===`
);
timeit('matrixMul (baseline)', () => {
  for (let i = 0; i < N_SOURCES_F64; i++) matrixMul(inverseFilters, channelVoltages);
});
timeit('Float64Array single pass', () => {
  computeActivationsF64(filtersF64, voltagesF64, N_SOURCES_F64, N_CHANNELS, activationsF64);
});

const N_SOURCES_F64_LARGE = 12000;
const filtersF64Large = new Float64Array(N_SOURCES_F64_LARGE * 3 * N_CHANNELS);
for (let s = 0; s < N_SOURCES_F64_LARGE; s++) {
  for (let row = 0; row < 3; row++) {
    for (let c = 0; c < N_CHANNELS; c++) {
      filtersF64Large[s * 3 * N_CHANNELS + row * N_CHANNELS + c] = inverseFilters[row][c];
    }
  }
}
const activationsF64Large = new Float64Array(N_SOURCES_F64_LARGE);

console.log(
  `\n=== Test 3: Flat Float64Array — ${N_SOURCES_F64_LARGE}× [3×${N_CHANNELS}] × [${N_CHANNELS}×1] ===`
);
timeit('matrixMul (baseline)', () => {
  for (let i = 0; i < N_SOURCES_F64_LARGE; i++) matrixMul(inverseFilters, channelVoltages);
});
timeit('Float64Array single pass', () => {
  computeActivationsF64(
    filtersF64Large,
    voltagesF64,
    N_SOURCES_F64_LARGE,
    N_CHANNELS,
    activationsF64Large
  );
});

// --- Test 4: Flat Float32Array — single pass, 32-bit precision ---
// Half the memory bandwidth of Float64 — more filter data fits in CPU cache at once,
// and V8 is more likely to auto-vectorize with SIMD (4 floats per instruction vs 2).
const N_SOURCES_F32 = 4500;
const filtersF32 = new Float32Array(N_SOURCES_F32 * 3 * N_CHANNELS);
for (let s = 0; s < N_SOURCES_F32; s++) {
  for (let row = 0; row < 3; row++) {
    for (let c = 0; c < N_CHANNELS; c++) {
      filtersF32[s * 3 * N_CHANNELS + row * N_CHANNELS + c] = inverseFilters[row][c];
    }
  }
}
const voltagesF32 = new Float32Array(channelVoltages.map((row) => row[0]));
const activationsF32 = new Float32Array(N_SOURCES_F32);

function computeActivationsF32(filterData, voltages, nSources, nChannels, result) {
  for (let s = 0; s < nSources; s++) {
    const base = s * 3 * nChannels;
    let mx = 0,
      my = 0,
      mz = 0;
    for (let c = 0; c < nChannels; c++) {
      const v = voltages[c];
      mx += filterData[base + c] * v;
      my += filterData[base + nChannels + c] * v;
      mz += filterData[base + 2 * nChannels + c] * v;
    }
    result[s] = Math.sqrt(mx * mx + my * my + mz * mz);
  }
}

console.log(
  `\n=== Test 4: Flat Float32Array — ${N_SOURCES_F32}× [3×${N_CHANNELS}] × [${N_CHANNELS}×1] ===`
);
timeit('matrixMul (baseline)', () => {
  for (let i = 0; i < N_SOURCES_F32; i++) matrixMul(inverseFilters, channelVoltages);
});
timeit('Float32Array single pass', () => {
  computeActivationsF32(filtersF32, voltagesF32, N_SOURCES_F32, N_CHANNELS, activationsF32);
});

const N_SOURCES_F32_LARGE = 12000;
const filtersF32Large = new Float32Array(N_SOURCES_F32_LARGE * 3 * N_CHANNELS);
for (let s = 0; s < N_SOURCES_F32_LARGE; s++) {
  for (let row = 0; row < 3; row++) {
    for (let c = 0; c < N_CHANNELS; c++) {
      filtersF32Large[s * 3 * N_CHANNELS + row * N_CHANNELS + c] = inverseFilters[row][c];
    }
  }
}
const activationsF32Large = new Float32Array(N_SOURCES_F32_LARGE);

console.log(
  `\n=== Test 4: Flat Float32Array — ${N_SOURCES_F32_LARGE}× [3×${N_CHANNELS}] × [${N_CHANNELS}×1] ===`
);
timeit('matrixMul (baseline)', () => {
  for (let i = 0; i < N_SOURCES_F32_LARGE; i++) matrixMul(inverseFilters, channelVoltages);
});
timeit('Float32Array single pass', () => {
  computeActivationsF32(
    filtersF32Large,
    voltagesF32,
    N_SOURCES_F32_LARGE,
    N_CHANNELS,
    activationsF32Large
  );
});

// === Test 1: Scaling NxN × NxN matrix multiplication ===

//   4×4:
//   matrixMul: 0.01ms median over 10 runs
//   matrixMuls: 0.01ms median over 10 runs
//   mathjs multiply: 0.02ms median over 10 runs

//   16×16:
//   matrixMul: 0.07ms median over 10 runs
//   matrixMuls: 0.08ms median over 10 runs
//   mathjs multiply: 0.09ms median over 10 runs

//   32×32:
//   matrixMul: 0.48ms median over 10 runs
//   matrixMuls: 0.52ms median over 10 runs
//   mathjs multiply: 0.21ms median over 10 runs

//   64×64:
//   matrixMul: 1.14ms median over 10 runs
//   matrixMuls: 1.65ms median over 10 runs
//   mathjs multiply: 1.48ms median over 10 runs

//   128×128:
//   matrixMul: 7.42ms median over 10 runs
//   matrixMuls: 7.69ms median over 10 runs
//   mathjs multiply: 6.00ms median over 10 runs

//   256×256:
//   matrixMul: 57.71ms median over 10 runs
//   matrixMuls: 59.90ms median over 10 runs
//   mathjs multiply: 47.13ms median over 10 runs

//   512×512:
//   matrixMul: 629.71ms median over 10 runs
//   matrixMuls: 530.84ms median over 10 runs
//   mathjs multiply: 431.79ms median over 10 runs

// === Test 2: ESI loop — 4500× [3×208] × [208×1] ===
//   matrixMul: 13.35ms median over 5 runs
//   matrixMuls: 142.07ms median over 5 runs
//   mathjs multiply: 112.55ms median over 5 runs

// === Test 2: ESI loop — 12000× [3×208] × [208×1] ===
//   matrixMul: 32.58ms median over 5 runs
//   matrixMuls: 385.27ms median over 5 runs
//   mathjs multiply: 301.95ms median over 5 runs

// === Test 3: Flat Float64Array — 4500× [3×208] × [208×1] ===
//   matrixMul (baseline): 13.03ms median over 10 runs
//   Float64Array single pass: 2.04ms median over 10 runs

// === Test 3: Flat Float64Array — 12000× [3×208] × [208×1] ===
//   matrixMul (baseline): 34.31ms median over 10 runs
//   Float64Array single pass: 5.46ms median over 10 runs

// === Test 4: Flat Float32Array — 4500× [3×208] × [208×1] ===
//   matrixMul (baseline): 12.68ms median over 10 runs
//   Float32Array single pass: 2.14ms median over 10 runs

// === Test 4: Flat Float32Array — 12000× [3×208] × [208×1] ===
//   matrixMul (baseline): 33.95ms median over 10 runs
//   Float32Array single pass: 5.33ms median over 10 runs
