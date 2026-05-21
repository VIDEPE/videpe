import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs) => twMerge(clsx(inputs));

export const handleScrollToSection = (section_id) => {
  const target = document.getElementById(section_id);
  if (target) {
    target.scrollIntoView({ block: 'start' });
  }
};

// Handles navigation - scrolls to sections (#section) or navigates to pages.
// Supports mixed routes like "/#projects" (navigate to home then scroll to section).
export const handleNavigation = (event, href, navigate) => {
  event.preventDefault();

  if (href.includes('/#')) {
    const [route, section] = href.split('/#');
    navigate(route || '/');
    // Longer timeout ensures DOM is updated after navigation in HashRouter
    setTimeout(() => {
      handleScrollToSection(section);
    }, 100);
  } else if (href.startsWith('#')) {
    handleScrollToSection(href.replace('#', ''));
  } else {
    navigate(href);
  }
};
