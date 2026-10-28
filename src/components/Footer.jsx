import { cn } from '@/utils/utils';
import { useTheme } from '@/components/ThemeContext';
import unigeLight from '@/assets/logo_UNIGE_light.png';
import unigeDark from '@/assets/logo_UNIGE_dark.png';
import hugLight from '@/assets/logo_hug_h_light.png';
import hugDark from '@/assets/logo_hug_h_dark.png';

export const Footer = () => {
  const { isDarkMode } = useTheme();
  return (
    <footer
      className={cn(
        'py-1 px-4 bg-surface border-t border-border mt-auto',
        // three columns, the outer two of equal width, so the middle one (the logos) sits in the
        // middle of the page whatever the width of the text on the left
        'grid grid-cols-[1fr_auto_1fr] items-center gap-3'
      )}
    >
      {/* Ownership statement */}
      {/* flex-wrap moves whole lines below each other when they don't fit side by side, and
       *:whitespace-nowrap stops the text from wrapping inside a line */}
      <div className="flex flex-wrap gap-x-2 text-xs text-foreground whitespace-nowrap">
        <p>VIDEPE v0.21.0 &copy; {new Date().getFullYear()}</p>
        <p>Clinical Neurosciences Department UNIGE & HUG.</p>
        <p>All rights reserved.</p>
      </div>
      {/* Logo's */}
      <div className="flex items-center gap-3">
        <img src={isDarkMode ? unigeDark : unigeLight} alt="UNIGE" className="h-13 w-auto" />
        <img src={isDarkMode ? hugDark : hugLight} alt="HUG" className="h-10 w-auto" />
      </div>
    </footer>
  );
};
