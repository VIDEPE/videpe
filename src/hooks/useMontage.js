import { useState, useCallback } from 'react';

/**
 * Owns the EEG reference montage — currently 'none' | 'average' | 'median', with room to
 * grow into more montage types (e.g. bipolar, laplacian) and bad-channel selection later.
 * Deliberately has no knowledge of any feature that depends on a particular montage (e.g.
 * Electrical Source Imaging, which requires 'average') — that dependency lives in the
 * feature's own hook, which takes `montage`/`setMontage` as inputs instead of this hook
 * reaching out to know about it.
 *
 * @returns {Object} The current montage state, plus the functions to drive it:
 *   - `montage` ('none'|'average'|'median') — the currently selected EEG reference montage.
 *   - `setMontage` (newMontage: string) => void — the raw state setter, for direct control
 *     by the caller (e.g. EegViewer's montage dropdown) or by dependent hooks/effects that
 *     need to change the montage on the user's behalf (e.g. forcing 'average' for ESI).
 *   - `resetMontage` () => void — resets the montage back to 'none'.
 */
export function useMontage() {
  // 'none' | 'average' | 'median'
  const [montage, setMontage] = useState('none');

  const resetMontage = useCallback(() => setMontage('none'), []);

  return { montage, setMontage, resetMontage };
}
