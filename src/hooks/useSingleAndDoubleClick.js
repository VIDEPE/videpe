import { useState, useEffect } from 'react';

/**
 * hook to differentiate single click from a double click on the same element, firing exactly one
 * of the two callbacks (so double click doesn't also fire the single click action first).
 * A click only resolves to "single" once `delay` ms pass with no follow-up click;
 * A second click within that window resolves to "double" and fires immediately.
 *
 * @param {() => void} actionSingleClick - called once `delay` ms after a single click, if no second click arrives.
 * @param {() => void} actionDoubleClick - called immediately once a second click lands within `delay` ms of the first.
 * @param {number} [delay=250] - the max gap (ms) between clicks that still counts as a double click.
 * @returns {() => void} click handler to attach to the element's onClick.
 */
export function useSingleAndDoubleClick(actionSingleClick, actionDoubleClick, delay = 250) {
  const [click, setClick] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      // single click
      if (click === 1) actionSingleClick();
      setClick(0);
    }, delay);

    // the duration between this click and the previous one
    // is less than the value of delay = double-click
    if (click === 2) actionDoubleClick();

    return () => clearTimeout(timer);
  }, [click]);

  return () => setClick((prev) => prev + 1);
}

/**
 * Double-click-to-reset variant of {@link useSingleAndDoubleClick}: a single click is a
 * no-op, and a double click within `delay` ms calls `actionDoubleClick` with `defaultVal` —
 * e.g. wiring a slider thumb's onClick so double-clicking it resets the slider to its default.
 *
 * @param {(defaultVal: *) => void} actionDoubleClick - called with `defaultVal` when a second click lands within `delay` ms of the first.
 * @param {*} defaultVal - the value passed to `actionDoubleClick` on a double click.
 * @param {number} [delay=250] - the max gap (ms) between clicks that still counts as a double click.
 * @returns {() => void} click handler to attach to the element's onClick.
 */
export function useDoubleClickToDefault(actionDoubleClick, defaultVal, delay = 250) {
  const [click, setClick] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      // single click => does nothing, but reset setClick to 0 after delay
      setClick(0);
    }, delay);

    // the duration between this click and the previous one
    // is less than the value of delay = double-click
    if (click === 2) actionDoubleClick(defaultVal);

    return () => clearTimeout(timer);
  }, [click]);

  return () => setClick((prev) => prev + 1);
}
