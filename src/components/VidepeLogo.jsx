import { BrainCircuit } from 'lucide-react';

// The two sizes of the logo, with the styles each used before they shared this component:
// - large: the landing page's hero.
// - small: the start-up pages of the launch modes (Shanoir, host app).
const SIZES = {
  large: {
    icon: 220,
    name: '!mb-0 !text-6xl tracking-widest',
    subtitle: 'text-lg text-foreground/60 tracking-wide text-center',
  },
  small: {
    icon: 160,
    name: 'text-4xl font-semibold tracking-widest pt-2 text-heading',
    subtitle: 'text-sm pb-6 text-foreground tracking-wide',
  },
};

/**
 * VIDEPE logo: the BrainCircuit icon, the wide-spaced name, the subtitle and the "For Research
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
      <div
        aria-hidden={asHeading ? undefined : 'true'}
        className="flex flex-col items-center gap-2"
      >
        <BrainCircuit size={styles.icon} strokeWidth={1} style={{ stroke: 'var(--c-primary)' }} />
        <Name className={styles.name}>VIDEPE</Name>
        <p className={styles.subtitle}>Unifying Brain Data</p>
      </div>
      {/* Always read out, also when the rest is decorative: it matters to the user */}
      <ResearchUseBadge className="mt-1" />
    </div>
  );
}

/**
 * The "For Research Use Only - In Development" badge, shown with the VIDEPE name on every page
 * (VidepeLogo, and PatientView's header), so users always see VIDEPE's status. "For Research
 * Use Only" is the official RUO wording.
 *
 * @param {Object} props
 * @param {string} [props.className] - extra classes, e.g. spacing for where it's placed.
 */
export function ResearchUseBadge({ className = '' }) {
  return (
    <span
      className={`text-xs text-foreground/40 border border-border/60 rounded-full px-2 py-0.5 ${className}`}
    >
      For Research Use Only - In Development
    </span>
  );
}
