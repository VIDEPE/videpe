import { VidepeLogo } from '@/components/VidepeLogo';
import { TOKEN_STORAGE_KEY } from '@/hostApp/hostAppLaunch';

// Shown when a host-app launch can't start, e.g. a broken launch link. (Errors while loading
// the files come later, in PatientView's toasts.) The host-app counterpart of
// ShanoirErrorPage: plain text only — no logo, as the Shanoir logo is reserved for the
// official Shanoir collaboration.
export function HostAppErrorPage({ error, appName }) {
  // Opening VIDEPE without the host app must not pick up a token an earlier launch stored in
  // this tab, or it would open that launch again instead of the local-files app
  const forgetLaunch = () => {
    try {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // storage blocked: nothing was stored to forget
    }
  };

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
        <p>Click &lsquo;View in VIDEPE&rsquo; in {appName} again</p>
        <p>or</p>
        <p>
          Open{' '}
          <a className="underline" href={import.meta.env.BASE_URL} onClick={forgetLaunch}>
            VIDEPE without {appName}
          </a>{' '}
          to view local files.
        </p>
      </div>
    </div>
  );
}
