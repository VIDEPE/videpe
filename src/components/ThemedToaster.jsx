import { Toaster } from 'react-hot-toast';

// Uses CSS variables from index.css so toast colors always match the active theme automatically.
export const ThemedToaster = () => (
  <Toaster
    position="top-left"
    reverseOrder={true}
    toastOptions={{
      // Ensure toasts follow the app's theme
      style: {
        background: 'var(--c-surface)',
        color: 'var(--c-foreground)',
        border: '1px solid var(--c-border)',
      },
      // Accessibility props to ensure screen readers announce the toasts.
      // 'role: status' indicates that the content is a status message
      // 'aria-live: polite' means it should be announced at the next available opportunity without interrupting the user.
      ariaProps: {
        role: 'status',
        'aria-live': 'polite',
      },
    }}
  />
);
