import { buildFilterSections, applyFilterSections } from './eegFilters.js';
import { median } from './arrayAndMatrixMathUtils.js';

// --- Benchmarks ---
// Run with: node src/utils/benchmarkEegFilters.js
//
// Question this answers: is it worth caching buildFilterSections's output across montage rows
// that share identical highPass/lowPass/notch settings (a Map keyed by e.g.
// `${highPass}|${lowPass}|${notch}`), or is building coefficients from scratch every time
// already cheap enough that a cache would just be complexity for no real gain? See
// applyMontageRowFilter in eegFilters.js for where this call happens per row.

// performance.now() is a global in Node 16+; if unavailable, swap for Date.now()
function timeit(label, fn, runs = 10) {
  // run a function multiple times and report the median execution time
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  const medianTime = median(times);
  console.log(`  ${label}: ${medianTime.toFixed(4)}ms median over ${runs} runs`);
  return medianTime;
}

const fs = 256;

// --- Test 1: buildFilterSections vs. a Map cache lookup, one call each ---
console.log('\n=== Test 1: buildFilterSections vs. Map cache lookup (single call) ===');
// warmup, so JIT compilation doesn't skew the first timed run
for (let i = 0; i < 50; i++) buildFilterSections(fs, 1, 40, 50);

const buildMs = timeit(
  'buildFilterSections(fs, 1, 40, 50)',
  () => buildFilterSections(fs, 1, 40, 50),
  200
);

const cache = new Map([['1|40|50', buildFilterSections(fs, 1, 40, 50)]]);
const lookupMs = timeit('cache.get(key)', () => cache.get('1|40|50'), 200);

console.log(`  -> building is ~${(buildMs / lookupMs).toFixed(0)}x slower than a cache hit`);

// --- Test 2: applyFilterSections on a realistically-sized buffer ---
// useEegBuffer keeps ~N_BUFFER_WINDOWS (15) window-sizes of margin loaded per side — this
// approximates that total buffered length, to put Test 1's numbers in context against the
// actual per-row cost once filtering (not just coefficient design) is included.
console.log('\n=== Test 2: applyFilterSections on a realistic buffer (context for Test 1) ===');
const bufferLen = 80000;
const samples = Array.from({ length: bufferLen }, (_, i) => Math.sin(i * 0.01));
const sections = buildFilterSections(fs, 1, 40, 50);
const filterMs = timeit(
  `applyFilterSections (${bufferLen} samples, no window)`,
  () => applyFilterSections(samples, sections),
  10
);

console.log(
  `  -> buildFilterSections is only ~${((buildMs / filterMs) * 100).toFixed(3)}% of one row's actual filtering cost`
);

// --- Test 3: scaling to a large montage — total cost across N rows ---
// Worst case for a cache (every row has unique settings, so it never hits) vs. best case
// (every row shares the same settings, so it hits every time after the first).
console.log('\n=== Test 3: total coefficient-build cost across a 200-row montage ===');
const N = 200;

timeit(
  `build fresh x${N} (all unique settings — worst case for a cache)`,
  () => {
    for (let i = 0; i < N; i++) buildFilterSections(fs, 1 + i * 0.01, 40 + i * 0.01, 50);
  },
  20
);

timeit(
  `build fresh x${N} (identical settings — cache would help most here)`,
  () => {
    for (let i = 0; i < N; i++) buildFilterSections(fs, 1, 40, 50);
  },
  20
);

const rowCache = new Map();
timeit(
  `cached lookup x${N} (identical settings, one real build then ${N - 1} hits)`,
  () => {
    rowCache.clear();
    for (let i = 0; i < N; i++) {
      const key = '1|40|50';
      if (!rowCache.has(key)) rowCache.set(key, buildFilterSections(fs, 1, 40, 50));
      rowCache.get(key);
    }
  },
  20
);

console.log(
  `  -> for comparison, actually filtering ${N} rows at this buffer size would cost ~${((filterMs * N) / 1000).toFixed(2)}s total`
);

// === Test 1: buildFilterSections vs. Map cache lookup (single call) ===
//   buildFilterSections(fs, 1, 40, 50): 0.0053ms median over 200 runs
//   cache.get(key): 0.0001ms median over 200 runs
//   -> building is ~53x slower than a cache hit

// === Test 2: applyFilterSections on a realistic buffer (context for Test 1) ===
//   applyFilterSections (80000 samples, no window): 9.6342ms median over 10 runs
//   -> buildFilterSections is only ~0.055% of one row's actual filtering cost

// === Test 3: total coefficient-build cost across a 200-row montage ===
//   build fresh x200 (all unique settings — worst case for a cache): 1.0869ms median over 20 runs
//   build fresh x200 (identical settings — cache would help most here): 1.0121ms median over 20 runs
//   cached lookup x200 (identical settings, one real build then 199 hits): 0.0125ms median over 20 runs
//   -> for comparison, actually filtering 200 rows at this buffer size would cost ~1.93s total
//
// Conclusion: a coefficient cache saves ~1ms out of a ~2s total per-buffer-load filtering cost
// for a large montage — not worth the added complexity (keying, invalidation, threading a cache
// through every call site). buildFilterSections inline, every call, is fine as-is.
