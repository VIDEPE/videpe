import { useMemo } from 'react';
import { buildIntracranialMatrix } from '@/utils/eegTopographyUtils';
import { interpolateDivergingColor } from '@/utils/eegColormaps';

// Renders intracranial electrode voltages as a row(group)/column(contact number)
// matrix instead of the scalp mesh — see EegTopoViewer, which swaps this in for
// intracranial recordings. Pure channel-name-derived, no electrode position file
// needed (unlike the 3D connectome, which does).
export function EegMatrixViewer({ channelNames, voltages, colourBlindMode }) {
  const { groups, unparsed } = useMemo(
    () => buildIntracranialMatrix(channelNames, voltages),
    [channelNames, voltages]
  );
  // Symmetric colour range so blue/red are equal distance from zero, same convention as EegTopoViewer.
  const calMax = useMemo(() => Math.max(1e-6, ...voltages.map((v) => Math.abs(v))), [voltages]);
  // Columns span every group's contact range, not just one group's — so a row with fewer contacts gets gap cells.
  const maxContact = Math.max(0, ...groups.map((g) => g.contacts.at(-1)?.contact ?? 0));
  const columns = Array.from({ length: maxContact }, (_, i) => i + 1);

  return (
    <div
      className="absolute inset-0 overflow-auto themed-scrollbar p-1"
      data-testid="eeg-matrix-viewer"
    >
      <table className="border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="sticky left-0 bg-surface px-1" />
            {columns.map((contact) => (
              <th key={contact} className="px-1 text-foreground/60 font-normal">
                {contact}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(({ group, contacts }) => (
            <tr key={group} data-testid={`matrix-row-${group}`}>
              <th className="sticky left-0 bg-surface px-1 text-left text-foreground/80">
                {group}
              </th>
              {columns.map((contact) => {
                const cell = contacts.find((c) => c.contact === contact);
                return (
                  <td
                    key={contact}
                    data-testid={`matrix-cell-${group}-${contact}`}
                    title={cell ? `${group}${contact}: ${cell.voltage.toFixed(2)} µV` : undefined}
                    style={{
                      backgroundColor: cell
                        ? interpolateDivergingColor(cell.voltage, calMax, colourBlindMode)
                        : 'transparent',
                      width: 22,
                      height: 18,
                    }}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {unparsed.length > 0 && (
        <p className="text-[10px] text-foreground/50 mt-1" data-testid="matrix-unparsed">
          {unparsed.length} channel(s) not recognized as electrode contacts:{' '}
          {unparsed.map((u) => u.name).join(', ')}
        </p>
      )}
    </div>
  );
}
