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
        'flex flex-wrap justify-start items-center gap-3'
      )}
    >
      <p className="text-sm text-foreground">
        VIDEPE v0.21.0 &copy; {new Date().getFullYear()} Clinical Neurosciences Department UNIGE & HUG. All
        rights reserved.
      </p>
      {/* Dark/Light mode logo */}
      <img
        src={isDarkMode ? unigeDark : unigeLight}
        alt="UNIGE"
        className="h-15 w-auto"
      />
	  <img
        src={isDarkMode ? hugDark : hugLight}
        alt="HUG"
        className="h-13 w-auto"
      />
    </footer>
  );
};
