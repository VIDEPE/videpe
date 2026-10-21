import { describe, it, expect, afterEach, vi } from 'vitest';
import { createFrameBudget, FRAME_BUDGET_MS } from '@/utils/frameBudget';
import { yieldToMain } from '@/utils/yieldToMain';

// Replaced with an instant pause so tests can count pauses and run code (e.g. cancel) during one
vi.mock('@/utils/yieldToMain', () => ({ yieldToMain: vi.fn(() => Promise.resolve()) }));

// Fake clock: each test sets the time explicitly, independent of how fast the machine is
let now = 0;
const setNow = (ms) => (now = ms);

afterEach(() => {
  vi.restoreAllMocks();
  yieldToMain.mockClear();
});

const setup = (budgetMs) => {
  setNow(0);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  return createFrameBudget(budgetMs);
};

describe('createFrameBudget', () => {
  it('does not pause while the burst is within its budget', async () => {
    const pauseIfOverBudget = setup();
    setNow(FRAME_BUDGET_MS - 1);
    await pauseIfOverBudget();
    expect(yieldToMain).not.toHaveBeenCalled();
  });

  it('pauses once the burst has used up its budget', async () => {
    const pauseIfOverBudget = setup();
    setNow(FRAME_BUDGET_MS);
    await pauseIfOverBudget();
    expect(yieldToMain).toHaveBeenCalledTimes(1);
  });

  it('starts a new burst after pausing, so it does not pause again right away', async () => {
    const pauseIfOverBudget = setup();
    setNow(FRAME_BUDGET_MS);
    await pauseIfOverBudget(); // pauses; the new burst starts now
    setNow(FRAME_BUDGET_MS + 1);
    await pauseIfOverBudget();
    expect(yieldToMain).toHaveBeenCalledTimes(1);
  });

  it('uses a custom budget when given one', async () => {
    const pauseIfOverBudget = setup(50);
    setNow(49);
    await pauseIfOverBudget();
    expect(yieldToMain).not.toHaveBeenCalled();
    setNow(50);
    await pauseIfOverBudget();
    expect(yieldToMain).toHaveBeenCalledTimes(1);
  });

  it('rejects with an AbortError when the signal is aborted during the pause', async () => {
    const pauseIfOverBudget = setup();
    const controller = new AbortController();
    yieldToMain.mockImplementationOnce(() => {
      controller.abort(); // e.g. a newer request replaced this one during the pause
      return Promise.resolve();
    });
    setNow(FRAME_BUDGET_MS);
    await expect(pauseIfOverBudget(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('does not check the signal when it does not pause', async () => {
    // cancelling is only checked after a pause — between pauses the work just continues
    const pauseIfOverBudget = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(pauseIfOverBudget(controller.signal)).resolves.toBeUndefined();
  });
});
