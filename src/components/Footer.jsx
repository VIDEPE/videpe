import { cn } from '@/lib/utils';
import { ArrowUp } from 'lucide-react';

export const Footer = () => {
  const handleScrollToTop = (event) => {
    event.preventDefault();
    const target = document.getElementById('hero');
    if (target) {
      target.scrollIntoView({ block: 'start' });
    }
  };

  return (
    <footer
      className={cn(
        'py-4 px-4 bg-surface border-t border-border mt-auto',
        'flex flex-wrap justify-between items-center'
      )}
    >
      <p className="text-sm text-foreground">
        &copy; {new Date().getFullYear()} Clinical NeuroScience Department HUG. All rights reserved.
      </p>

      <a
        href="#hero"
        onClick={handleScrollToTop}
        className={cn(
          'p-2 rounded-full text-primary transition-all duration-300',
          'hover:drop-shadow-[0_0_8px_var(--c-primary)]'
        )}
      >
        <ArrowUp className="w-9 h-9 animate-bounce-up" />
      </a>
    </footer>
  );
};
