import { cn } from '@/utils/utils';

export const Footer = () => {
  return (
    <footer
      className={cn(
        'py-4 px-4 bg-surface border-t border-border mt-auto',
        'flex flex-wrap justify-between items-center'
      )}
    >
      <p className="text-sm text-foreground">
        VIDEPE v0.16.0 &copy; {new Date().getFullYear()} Clinical NeuroScience Department HUG. All
        rights reserved.
      </p>
    </footer>
  );
};
