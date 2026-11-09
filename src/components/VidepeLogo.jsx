import { useEffect, useId, useRef, useState } from 'react';
import { BrainCircuit, TriangleAlert } from 'lucide-react';
import { cn } from '@/utils/utils';
import { VidepeTitle } from '@/components/VidepeTitle';
// The RUO disclaimer, shared with the About page so both always show the same text.
// ?raw: import the file's contents as a string, instead of its URL
import DISCLAIMER_TEXT from '@/assets/ruo_disclaimer.txt?raw';

// The two sizes of the logo:
// - large: the landing page's hero. Its name is an <h1>, so it gets the global h1 styles
//   (index.css: weight 500, heading colour, -1.68px letter-spacing, 20px top margin), which
//   beat Tailwind utilities — hence the ! on the ones that must win.
// - small: the start-up pages of the launch modes (Shanoir, host app). A scaled-down copy of
//   large: its name is a <span>, so it sets the h1 styles itself, scaled to its font size.
const SIZES = {
  large: {
    icon: 220,
    name: '!mb-0 !text-6xl',
    subtitle: 'text-lg text-foreground/60 tracking-wide text-center',
  },
  small: {
    icon: 160,
    // tracking: the h1's -1.68px ÷ the landing name's 67.5px (text-6xl at the 18px desktop root)
    name: 'text-4xl font-medium tracking-[-0.025em] mt-4 text-heading',
    subtitle: 'text-sm text-foreground/60 tracking-wide text-center',
  },
};

/**
 * VIDEPE logo: the BrainCircuit icon, the name, the subtitle and the "For Research
 * Use Only - In Development" badge — the same on every page, so VIDEPE looks consistent
 * wherever it opens, and users always see it's for research use only and still in development.
 *
 * @param {Object} props
 * @param {'large'|'small'} [props.size='small'] - 'large' for the landing page's hero, 'small'
 *   for the start-up pages.
 * @param {boolean} [props.asHeading=false] - makes the name the page's <h1> (the landing
 *   page). Otherwise the icon, name and subtitle are decorative only (aria-hidden): the
 *   page's own heading carries the actual message (e.g. "VIDEPE could not be opened").
 */
export function VidepeLogo({ size = 'small', asHeading = false }) {
  const styles = SIZES[size];
  const Name = asHeading ? 'h1' : 'span';
  return (
    <div className="flex flex-col items-center gap-2 select-none pointer-events-none">
      {/* VIDEPE Icon + Name + Subtitle*/}
      <div
        aria-hidden={asHeading ? undefined : 'true'}
        className="flex flex-col items-center gap-2"
      >
        <BrainCircuit size={styles.icon} strokeWidth={1} style={{ stroke: 'var(--c-primary)' }} />
        {/* The name reveals what each letter stands for on hover */}
        <VidepeTitle as={Name} className={styles.name} />
        <p className={styles.subtitle}>Unifying Brain Data</p>
      </div>
      {/* Disclaimer Badge, sits outside aria-hidden, so it's always read out in accessibility mode, 
      also when the rest is decorative. RUO disclaimer is important */}
      <ResearchUseBadge className="mt-1" />
    </div>
  );
}

/**
 * The "For Research Use Only - In Development" badge, shown with the VIDEPE name on every page
 * (VidepeLogo, and PatientView's header), so users always see VIDEPE's status. "For Research
 * Use Only" is the official RUO wording.
 *
 * Clicking it opens a card with the full disclaimer (the same text as the About page), like the
 * landing page's feature cards but on click instead of hover. A card rather than a link to the
 * About page: the start-up pages render outside the router, and leaving PatientView would
 * discard the loaded data.
 *
 * @param {Object} props
 * @param {string} [props.className] - extra classes, e.g. spacing for where it's placed.
 */
export function ResearchUseBadge({ className = '' }) {
  const [isOpen, setIsOpen] = useState(false);
  const badgeRef = useRef(null);
  const cardId = useId(); // links the button to the card it opens, for screen readers

  // While open: close on a click outside the badge and its card, or on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e) => {
      if (!badgeRef.current.contains(e.target)) setIsOpen(false);
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    // pointer-events-auto: turn pointer events back on, as both places it sits in (VidepeLogo,
    // PatientView's title) turn them off for their decorative elements
    <div ref={badgeRef} className={cn('relative pointer-events-auto', className)}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={cardId}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'text-xs text-foreground/40 hover:text-foreground cursor-pointer',
          'border border-border/60 rounded-full hover:border-border',
          'px-2 py-0.5'
        )}
      >
        For Research Use Only - In Development
      </button>
      {/* Disclaimer card — fades in below the badge on click, overlays the content below.
          aria-hidden/inert while closed, so screen readers and Tab skip the invisible card */}
      <div
        id={cardId}
        aria-hidden={!isOpen}
        inert={!isOpen}
        className={cn(
          'absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 w-120 max-w-[calc(100vw-2rem)]',
          'rounded-lg border border-alert bg-surface px-3 py-2 shadow-md text-left select-text',
          'transition-opacity duration-150',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
      >
        <div className="flex items-center gap-2">
          <TriangleAlert size={16} className="shrink-0 text-alert" />
          <span className="text-xs font-semibold text-heading">Research Use Only</span>
        </div>
        {/* Opens by animating its grid row from 0fr to 1fr, like the landing page's feature
            cards: unlike a max-height, this opens to exactly the height of the text */}
        <div
          className={cn(
            'grid transition-[grid-template-rows] duration-300 ease-out',
            isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          )}
        >
          <div className="overflow-hidden">
            <p className="pt-2 text-xs text-foreground">{DISCLAIMER_TEXT}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
