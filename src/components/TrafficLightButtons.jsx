import { Maximize2, Minimize2, ArrowLeftRight, X } from 'lucide-react';

const ICON_SIZE = 13;

const btn =
  'inline-flex items-center justify-center w-4 h-4 rounded-full border-none cursor-pointer transition-all text-foreground/50 hover:text-black/70 bg-border';

/**
 * macOS-style traffic light button row.
 *
 * Each button is optional — pass the handler to show it, omit to hide it.
 *   green  (onSwap)     — swap / rearrange panels
 *   yellow (onMaximize) — maximize / restore
 *   red    (onClose)    — close / reset
 *
 * @param {function}  [onSwap]      - Called when the green button is clicked. Omit to hide the button.
 * @param {boolean}   [isSwapped]   - Whether the panels are currently swapped; drives the aria-pressed state.
 * @param {function}  [onMaximize]  - Called when the yellow button is clicked. Omit to hide the button.
 * @param {boolean}   [isMaximized] - Whether the panel is currently maximized; switches the icon (Maximize2 ↔ Minimize2) and drives aria-pressed.
 * @param {function}  [onClose]     - Called when the red button is clicked. Omit to hide the button.
 * @param {string}    [closeTitle]  - Tooltip and aria-label for the red button. Defaults to "Close".
 */
export function TrafficLightButtons({
  onSwap,
  isSwapped,
  onMaximize,
  isMaximized,
  onClose,
  closeTitle = 'Close',
}) {
  return (
    <div className="flex items-center gap-1.5">
      {onSwap && (
        <button
          type="button"
          className={`${btn} hover:bg-[#28C840]`}
          onClick={onSwap}
          title="Swap panels"
          aria-label="Swap panels"
          aria-pressed={isSwapped}
        >
          <ArrowLeftRight size={ICON_SIZE} />
        </button>
      )}
      {onMaximize && (
        <button
          type="button"
          className={`${btn} hover:bg-[#FFBD2E]`}
          onClick={onMaximize}
          title={isMaximized ? 'Restore' : 'Maximize'}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
          aria-pressed={isMaximized}
        >
          {isMaximized ? <Minimize2 size={ICON_SIZE} /> : <Maximize2 size={ICON_SIZE} />}
        </button>
      )}
      {onClose && (
        <button
          type="button"
          className={`${btn} hover:bg-[#FF5F57]`}
          onClick={onClose}
          title={closeTitle}
          aria-label={closeTitle}
        >
          <X size={ICON_SIZE} />
        </button>
      )}
    </div>
  );
}
