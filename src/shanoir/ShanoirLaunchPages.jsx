import { BrainCircuit } from 'lucide-react';

// VIDEPE logo, same as the landing page's hero (BrainCircuit icon, wide-spaced name and
// subtitle), but smaller. Decorative only (aria-hidden): each page's heading carries the
// actual message.
function VidepeLogo({ size = 160 }) {
  return (
    <div aria-hidden="true" className="flex flex-col items-center gap-2 select-none">
      <BrainCircuit size={size} strokeWidth={1} style={{ stroke: 'var(--c-primary)' }} />
      <span className="text-4xl font-semibold tracking-widest pt-2 text-heading">VIDEPE</span>
      <span className="text-sm pb-6 text-foreground tracking-wide">Unifying Brain Data</span>
    </div>
  );
}

// Shown while a Shanoir launch signs in (redirect to Keycloak and back) — usually under a
// second per step. Fades in after a short delay, so fast sign-ins don't flash it at all.
export function ShanoirSignInPage() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="animate-delayed-fade-in min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center bg-background text-foreground"
    >
      <VidepeLogo />
      {/* Loading Spinner (same spinner as NiiViewer's loading overlay) */}
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-border border-t-primary" />
      {/* Explanatory text */}
      <h1 className="text-xl font-semibold">Signing in to Shanoir…</h1>
      <p className="max-w-xl text-foreground">VIDEPE will open the examination in a moment.</p>
    </div>
  );
}
export function ShanoirErrorPage({ error }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-2 text-center bg-background text-foreground">
      <VidepeLogo />
      {/* Title */}
      <h1 className="text-xl font-semibold">VIDEPE could not be opened</h1>
      {/* Error message */}
      <p className="max-w-xl whitespace-pre-line text-alert pb-6">
        {error?.message ?? String(error)}
      </p>
      {/* Action text */}
      <div className="text-sm">
        <p>Reopen VIDEPE from Shanoir</p>
        <p>or</p>
        <p>
          Open{' '}
          <a className="underline" href={import.meta.env.BASE_URL}>
            VIDEPE without Shanoir
          </a>{' '}
          to view local files.
        </p>
      </div>
    </div>
  );
}
