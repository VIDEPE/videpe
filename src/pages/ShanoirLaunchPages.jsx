// Shown while a Shanoir launch signs in (redirect to Keycloak and back) — usually under a
// second per step. Fades in after a short delay, so fast sign-ins don't flash it at all.
export function ShanoirLoadingPage() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="animate-delayed-fade-in min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100"
    >
      {/* same spinner as NiiViewer's loading overlay */}
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-border border-t-primary" />
      <h1 className="text-xl font-semibold">Signing in to Shanoir…</h1>
      <p className="max-w-xl text-gray-600 dark:text-gray-400">
        VIDEPE will open the examination in a moment.
      </p>
    </div>
  );
}
export function ShanoirErrorPage({ error }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <h1 className="text-xl font-semibold">VIDEPE could not be opened</h1>
      <p className="max-w-xl whitespace-pre-line text-gray-600 dark:text-gray-400">
        {error?.message ?? String(error)}
      </p>
      <div className="gap-2 text-sm">
        <p>Reopen VIDEPE from Shanoir</p>
        <p>or</p>
        <p>
          <a>Open </a>
          <a className="underline" href={import.meta.env.BASE_URL}>
            VIDEPE without Shanoir
          </a>{' '}
          to view local files.
        </p>
      </div>
    </div>
  );
}
