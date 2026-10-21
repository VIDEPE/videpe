import { yieldToMain } from '@/utils/yieldToMain';

// Long loops (demuxing, filtering) pause briefly once they have worked FRAME_BUDGET_MS without a
// break, so the browser can redraw and respond to clicks. Without these pauses, a large buffer
// would be processed as one uninterrupted block and freeze the app until it's done.
// A time budget (rather than a fixed amount of work) adapts to the data size and machine speed:
// 8ms keeps each burst comfortably under one frame (~16ms).
export const FRAME_BUDGET_MS = 8;

/**
 * Starts a time budget for a long loop. The loop decides *where* it can pause (e.g. every 1000
 * time points, or after each record) and calls the returned function there; the function decides
 * *whether* to pause, based on how long the current burst has been running.
 *
 * @param {number} [budgetMs=FRAME_BUDGET_MS] - how long to work before pausing.
 * @returns {(abortSignal?: AbortSignal) => Promise<void>} pauseIfOverBudget: if the current burst
 *   has used up its budget, pauses (see yieldToMain), then starts a new burst. Otherwise resolves
 *   straight away. If `abortSignal` was aborted during the pause, rejects with an AbortError, so
 *   the loop stops instead of finishing work whose result would be thrown away.
 */
export function createFrameBudget(budgetMs = FRAME_BUDGET_MS) {
  let burstStart = performance.now(); // when the current burst started
  return async function pauseIfOverBudget(abortSignal) {
    if (performance.now() - burstStart < budgetMs) return;
    await yieldToMain(); // pause the function and let the browser handle whatever is waiting, then continue
    abortSignal?.throwIfAborted(); // a newer request may have replaced this one during the pause
    burstStart = performance.now();
  };
}
