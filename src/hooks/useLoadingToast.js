import { useEffect } from 'react';
import toast from 'react-hot-toast';

/**
 * Shows a loading/success toast tracking `isLoading`, self-contained so the caller reports its
 * own status regardless of where it's embedded. Dismisses the toast if the caller unmounts mid-load.
 *
 * @param {boolean} isLoading - true while a load is in flight; toggling this fires the
 *   corresponding loading/success toast.
 * @param {string} toastId - fixed id so the loading/success toasts update the same toast in
 *   place rather than stacking new ones, and so the unmount cleanup dismisses the right one.
 * @param {boolean} [hasError] - true if the load that just finished failed. isLoading alone
 *   can't tell success from failure (it's just "in flight" vs "not"), so without this the
 *   loading toast would always resolve into a misleading "Imaging data loaded!" success toast,
 *   right alongside the caller's own error toast(s) for the same failure. When true, the loading
 *   toast is dismissed instead — the caller's own error toast(s) are the only feedback shown.
 * @returns {void} — side-effecting only, nothing to read back.
 */
export function useLoadingToast(isLoading, toastId, hasError = false) {
  useEffect(() => {
    if (isLoading) {
      toast.loading('Loading imaging data…', { id: toastId });
    } else if (hasError) {
      toast.dismiss(toastId);
    } else {
      toast.success('Imaging data loaded!', { id: toastId });
    }
  }, [isLoading, toastId, hasError]);

  // Dismiss the toast if the viewer unmounts mid-load.
  useEffect(() => {
    return () => toast.dismiss(toastId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
