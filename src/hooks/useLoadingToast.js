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
 * @returns {void} — side-effecting only, nothing to read back.
 */
export function useLoadingToast(isLoading, toastId) {
  useEffect(() => {
    if (isLoading) {
      toast.loading('Loading imaging data…', { id: toastId });
    } else {
      toast.success('Imaging data loaded!', { id: toastId });
    }
  }, [isLoading, toastId]);

  // Dismiss the toast if the viewer unmounts mid-load.
  useEffect(() => {
    return () => toast.dismiss(toastId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
