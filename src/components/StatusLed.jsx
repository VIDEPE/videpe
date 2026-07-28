import { cn } from '../utils/utils';
import { useTheme } from '@/components/ThemeContext';

/**
 * LED-style indicator for whether an optional file (electrode positions, inverse solution)
 * is loaded — overlaps the persistent dropzone's clickable area, since that dropzone shows
 * no state of its own in compact mode. Renders a colored dot plus label; the title
 * attribute carries the filename/match count/reason on hover.
 *
 * Color meanings:
 *   • green — a file is loaded and (if matchCount/totalCount are given) matches well
 *   • amber — a file is loaded, but matchCount/totalCount show too few matched channels
 *             — likely the wrong file
 *   • blue  — no file, but matchCount/totalCount (the standard_1005 template match) clear
 *             isGoodMatch
 *   • red   — nothing loaded, or a match too sparse to be usable (the title still reports
 *             the count, so a poor match isn't indistinguishable from no match at all)
 *   • grey  — disabled
 *
 * @param {string} label - display label (e.g. "Electrode Position"); also feeds the
 *   "No {label} loaded" / "{label} is not applicable..." fallback title text
 * @param {string|null} [fileName] - name of the loaded file, if any. Presence alone
 *   (regardless of match quality) decides the green/amber branch vs. the blue/red branch
 * @param {boolean} [disabled=false] - greys the LED out for a file type that doesn't apply
 *   to the current recording mode (e.g. inverse solution in iEEG) — greyed rather than
 *   removed so the layout doesn't jump and a loaded-but-unused file doesn't disappear
 * @param {number} [matchCount] - channels matched against this file/template. Provide
 *   together with totalCount to opt this LED into the "channels matched" concept — the
 *   count is then always shown in the title, regardless of match quality
 * @param {number} [totalCount] - total channel count in the recording, paired with matchCount
 * @param {boolean} [isGoodMatch=false] - whether the match clears the caller's quality bar
 *   (thresholds live with the caller, not here). Only affects color when matchCount/
 *   totalCount are both provided — LEDs with no match concept (e.g. Inverse Solution)
 *   always read green while active, never amber
 */
export const StatusLed = ({
  label,
  fileName,
  disabled = false,
  matchCount,
  totalCount,
  isGoodMatch = false,
}) => {
  // isDarkMode is the one source of truth that actually reflects the app's theme toggle.
  const { isDarkMode } = useTheme();
  const isActive = Boolean(fileName);
  const hasMatchInfo = matchCount != null && totalCount != null;
  // Match quality only demotes green→amber for LEDs that carry a matchCount (Electrode
  // Position) — LEDs with no such concept (e.g. Inverse Solution) have nothing to distrust,
  // so isGoodMatch's unset default (false) must not fall through to amber for them.
  const isActiveGood = !hasMatchInfo || isGoodMatch;
  const dotColor = disabled
    ? 'bg-foreground/20'
    : isActive
      ? isActiveGood
        ? isDarkMode
          ? 'bg-green-400'
          : 'bg-green-500'
        : isDarkMode
          ? 'bg-amber-400'
          : 'bg-amber-500'
      : hasMatchInfo && isGoodMatch
        ? isDarkMode
          ? 'bg-blue-400'
          : 'bg-blue-500'
        : isDarkMode
          ? 'bg-red-400/70'
          : 'bg-red-500/70';
  // Subtle glow only when on (green/amber) or a good auto-match (blue) — off (red) stays a flat dot
  const glow = disabled
    ? 'none'
    : isActive
      ? isActiveGood
        ? isDarkMode
          ? '0 0 4px 1px rgba(74,222,128,0.7)'
          : '0 0 4px 1px rgba(34,197,94,0.7)'
        : isDarkMode
          ? '0 0 4px 1px rgba(251,191,36,0.7)'
          : '0 0 4px 1px rgba(245,158,11,0.7)'
      : hasMatchInfo && isGoodMatch
        ? isDarkMode
          ? '0 0 4px 1px rgba(96,165,250,0.7)'
          : '0 0 4px 1px rgba(59,130,246,0.7)'
        : 'none';
  const matchSuffix = hasMatchInfo ? ` (${matchCount}/${totalCount} channels matched)` : '';
  const title = disabled
    ? `${label} is not applicable for iEEG recordings`
    : isActive
      ? hasMatchInfo
        ? `Custom: ${fileName}${matchSuffix}`
        : fileName
      : hasMatchInfo
        ? `Using standard_1005 template${matchSuffix}`
        : `No ${label.toLowerCase()} loaded`;
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 leading-none shrink-0 whitespace-nowrap cursor-help',
        disabled && (isDarkMode ? 'text-foreground/20' : 'text-foreground/40')
      )}
      title={title}
    >
      <span
        className={cn('h-2 w-2 rounded-full shrink-0 cursor-help', dotColor)}
        style={{ boxShadow: glow }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
};
