import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs) => twMerge(clsx(inputs));

/**
 * Scrolls to a section by ID
 * @param {string} section_id - The section ID to scroll to
 */
export const handleScrollToSection = (section_id) => {
    const target = document.getElementById(section_id);
    if (target) {
        target.scrollIntoView({ block: "start" });
    }
};

/**
 * Handles navigation - scrolls to sections (#section) or navigates to pages
 * Supports mixed routes like "/#projects" (navigate to home then scroll to section)
 * @param {Event} event - The event object
 * @param {string} href - The href/path to navigate to
 * @param {Function} navigate - React Router navigate function
 */
export const handleNavigation = (event, href, navigate) => {
    event.preventDefault();
    
    // Check for pattern "/#section" (navigate to route then scroll)
    if (href.includes("/#")) {
        const [route, section] = href.split("/#");
        navigate(route || "/");
        // Use longer timeout to ensure DOM is updated after navigation in HashRouter
        setTimeout(() => {
            handleScrollToSection(section);
        }, 100);
    }
    // Check if it's a section (starts with #) or a page
    else if (href.startsWith("#")) {
        // It's a section, scroll to it
        const section_id = href.replace("#", "");
        handleScrollToSection(section_id);
    } else {
        // It's a page, navigate using React Router
        navigate(href);
    }
};