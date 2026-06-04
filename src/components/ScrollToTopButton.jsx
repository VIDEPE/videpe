import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';

export const ScrollToTopButton = ({ threshold = 200 }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > threshold);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className="fixed bottom-6 right-6 z-50 animate-bounce cursor-pointer"
      style={{ background: 'none', border: 'none', color: 'var(--c-primary)' }}
      aria-label="Scroll to top"
    >
      <ArrowUp size={26} strokeWidth={2.5} />
    </button>
  );
};
