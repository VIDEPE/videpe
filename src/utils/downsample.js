/**
 * Min-max downsample a time-series to at most `targetPoints` output points.
 *
 * For each bucket, both the minimum and maximum sample are kept, so peaks and
 * troughs are never lost even at high compression ratios. Points are emitted in
 * time order so the output is a valid monotonically-increasing series.
 *
 * When the visible window contains fewer samples than `targetPoints` the raw
 * slice is returned as-is (no copy).
 *
 * @param {Float32Array} timestamps  Monotonically-increasing x values.
 * @param {Float32Array} values      Y values aligned with timestamps.
 * @param {number}       startTime   Start of the visible window.
 * @param {number}       endTime     End of the visible window.
 * @param {number}       pixelWidth  Width of the plot in pixels.
 * @returns {[Float32Array, Float32Array]} [downsampled timestamps, downsampled values]
 */
export function minMaxDownsample(timestamps, values, startTime, endTime, pixelWidth) {
  const targetPoints = pixelWidth * 2;
  const n = timestamps.length;
  if (n === 0) return [timestamps, values];

  // Compute start/end indices from the linearly-spaced timestamp array in O(1)
  const tStep = n > 1 ? (timestamps[n - 1] - timestamps[0]) / (n - 1) : 1;
  const startIdx = Math.max(0, Math.floor((startTime - timestamps[0]) / tStep));
  const endIdx = Math.min(n - 1, Math.ceil((endTime - timestamps[0]) / tStep));
  const nVisible = endIdx - startIdx + 1;

  // Already within budget — return a view/slice of the original arrays (no copy for TypedArrays)
  const cut = (arr, lo, hi) => (arr.subarray ? arr.subarray(lo, hi) : arr.slice(lo, hi));
  if (nVisible <= targetPoints) {
    return [cut(timestamps, startIdx, endIdx + 1), cut(values, startIdx, endIdx + 1)];
  }

  const buckets = Math.floor(targetPoints / 2);
  const outTs = new Float32Array(buckets * 2);
  const outVals = new Float32Array(buckets * 2);
  let out = 0;

  for (let b = 0; b < buckets; b++) {
    // Integer bucket boundaries avoid floating-point drift across many buckets
    const lo = startIdx + Math.floor((b * nVisible) / buckets);
    const hi = startIdx + Math.floor(((b + 1) * nVisible) / buckets);

    let minVal = Infinity,
      maxVal = -Infinity,
      minI = lo,
      maxI = lo;
    for (let i = lo; i < hi; i++) {
      const v = values[i];
      if (v < minVal) {
        minVal = v;
        minI = i;
      }
      if (v > maxVal) {
        maxVal = v;
        maxI = i;
      }
    }

    // Emit in time order so the series stays monotonically increasing
    if (minI <= maxI) {
      outTs[out] = timestamps[minI];
      outVals[out++] = minVal;
      outTs[out] = timestamps[maxI];
      outVals[out++] = maxVal;
    } else {
      outTs[out] = timestamps[maxI];
      outVals[out++] = maxVal;
      outTs[out] = timestamps[minI];
      outVals[out++] = minVal;
    }
  }

  return [outTs, outVals];
}
