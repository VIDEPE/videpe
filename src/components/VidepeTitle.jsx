import { cn } from '../utils/utils';

// Each acronym letter with the rest of its word — the linking words ("&", "of", "for") ride along
// with the word before them, so the revealed text reads as the full name
const ACRONYM = [
  { letter: 'V', rest: 'isualization &' },
  { letter: 'I', rest: 'ntegration of' },
  { letter: 'D', rest: 'ata for' },
  { letter: 'E', rest: 'pilepsy' },
  { letter: 'P', rest: 'resurgical' },
  { letter: 'E', rest: 'valuation' },
];

// How long the pointer must rest on the title before the words start to open. All words open
// together: the title is centered, so opening them one by one keeps shifting the letters already
// open and makes them hard to read
const REVEAL_DELAY_MS = 500;

const NBSP = String.fromCharCode(0xa0);

/**
 * The VIDEPE page title. Hovering it for a moment moves the letters apart and reveals, in small
 * text between them, what each letter stands for ("V isualization & I ntegration of …").
 * Leaving the title closes them again straight away.
 *
 * Each word opens by animating an inline-grid column from 0fr to 1fr, so it grows to exactly
 * its own text width without a hard-coded max-width. The delay sits only on the hover state,
 * so opening waits but closing doesn't. Reduced-motion users get the same reveal without the
 * slide.
 *
 * The revealed words are aria-hidden, so the heading's accessible name stays "VIDEPE".
 *
 * Used for PatientView's header title and for the name in VidepeLogo.
 *
 * @param {'h1'|'span'} [as='h1'] - the element to render: 'h1' when it's the page's heading,
 *   'span' when it's decorative (VidepeLogo on the start-up pages, where the page's own <h1>
 *   carries the message)
 * @param {string} [className] - extra classes for the element (e.g. margin or size overrides)
 */
export function VidepeTitle({ as: Tag = 'h1', className }) {
  return (
    // pointer-events-auto: the containers it sits in (PatientView's header center column,
    // VidepeLogo) are pointer-events-none, but the hover has to reach the title
    <Tag className={cn('group/title pointer-events-auto whitespace-nowrap', className)}>
      {ACRONYM.map(({ letter, rest }, i) => (
        <span key={i}>
          {letter}
          <span
            aria-hidden="true"
            className="inline-grid grid-cols-[0fr] align-baseline transition-[grid-template-columns] duration-500 ease-out group-hover/title:grid-cols-[1fr] group-hover/title:[transition-delay:var(--reveal-delay)] motion-reduce:transition-none"
            style={{ '--reveal-delay': `${REVEAL_DELAY_MS}ms` }}
          >
            {/* overflow-hidden lets the 0fr column shrink the word to nothing; the non-breaking
                space (not a trailing normal space, which would be dropped at the line end) keeps
                a gap before the next letter.
                text-[0.35em]: the words scale with the letters (em = the title's font size), 
                so they keep the same proportion in the header and both logo sizes */}
            <span className="overflow-hidden text-[0.35em] font-normal tracking-normal text-foreground/70 opacity-0 transition-opacity duration-500 group-hover/title:opacity-100 group-hover/title:[transition-delay:var(--reveal-delay)] motion-reduce:transition-none">
              {i < ACRONYM.length - 1 ? rest + NBSP : rest}
            </span>
          </span>
        </span>
      ))}
    </Tag>
  );
}
