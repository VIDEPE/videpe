import { Fragment, useMemo } from 'react';
import {
  buildIntracranialMatrix,
  splitChannelsByType,
  chunkContactsIntoLines,
} from '@/utils/eegTopographyUtils';
import { interpolateDivergingColor } from '@/utils/eegColormaps';

// Renders EEG/SEEG electrode voltages as row(group)/column(contact number) matrices — one
// section per channel type, EEG first then SEEG below it, since a recording can mix both
// (channel type is user-editable per channel in the Montage Editor). See EegTopoViewer, which
// swaps this in for the Matrix tab. Pure channel-name-derived, no electrode position file
// needed (unlike the 3D connectome, which does).
export function EegMatrixViewer({ channelNames, voltages, channelTypes, colourBlindMode }) {
  const buckets = useMemo(
    () => splitChannelsByType(channelNames, voltages, channelTypes),
    [channelNames, voltages, channelTypes]
  );
  const eegMatrix = useMemo(
    () => buildIntracranialMatrix(buckets.eeg.names, buckets.eeg.voltages),
    [buckets.eeg]
  );
  const seegMatrix = useMemo(
    () => buildIntracranialMatrix(buckets.seeg.names, buckets.seeg.voltages),
    [buckets.seeg]
  );

  // Channels that either aren't typed EEG/SEEG (e.g. ECG, trigger) or don't fit the
  // group+contact naming shape within their section — surfaced once, combined, at the bottom.
  const unparsed = [
    ...eegMatrix.unparsed,
    ...seegMatrix.unparsed,
    ...buckets.other.names.map((name) => ({ name })),
  ];

  return (
    <div
      className="absolute inset-0 overflow-auto themed-scrollbar p-1"
      data-testid="eeg-matrix-viewer"
    >
      <MatrixSection
        sectionKey="eeg"
        title="EEG"
        groups={eegMatrix.groups}
        colourBlindMode={colourBlindMode}
      />
      <MatrixSection
        sectionKey="seeg"
        title="SEEG"
        groups={seegMatrix.groups}
        colourBlindMode={colourBlindMode}
      />
      {unparsed.length > 0 && (
        <p className="text-[10px] text-foreground/50 mt-1" data-testid="matrix-unparsed">
          {unparsed.length} channel(s) not recognized as electrode contacts:{' '}
          {unparsed.map((u) => u.name).join(', ')}
        </p>
      )}
    </div>
  );
}

// One group(rows)/contact(columns) table for a single channel type. A group with more
// contacts than MATRIX_LINE_WIDTH (e.g. a 200+ contact high-density EEG net under one group
// letter) wraps onto multiple lines, each with its own header row directly above it showing
// that line's true contact-number range — see chunkContactsIntoLines. Columns share the same
// contact-number windows across every group in the section (not just each group's own max),
// so contact N always sits under the same header regardless of which probe it belongs to.
function MatrixSection({ sectionKey, title, groups, colourBlindMode }) {
  const maxContact = useMemo(
    () => Math.max(0, ...groups.flatMap((g) => g.contacts.map((c) => c.contact))),
    [groups]
  );
  // Own colour scale per section — EEG (scalp) and SEEG (depth) voltages typically differ by
  // an order of magnitude, so a single shared scale would wash out whichever type is smaller.
  const calMax = useMemo(
    () => Math.max(1e-6, ...groups.flatMap((g) => g.contacts.map((c) => Math.abs(c.voltage)))),
    [groups]
  );

  if (groups.length === 0) return null;

  return (
    <section
      className="border-t border-border pt-4 mb-4 first:border-t-0 first:pt-0 last:mb-0"
      data-testid={`matrix-section-${sectionKey}`}
    >
      <h3 className="px-1 text-[11px] font-semibold text-foreground/70">{title}</h3>
      <table className="border-collapse text-[11px]">
        <tbody>
          {groups.map(({ group, contacts }) =>
            chunkContactsIntoLines(contacts, maxContact).map((line, lineIdx) => {
              const columns = Array.from(
                { length: line.end - line.start + 1 },
                (_, i) => line.start + i
              );
              return (
                <Fragment key={`${group}-${lineIdx}`}>
                  <tr>
                    <th className="sticky left-0 bg-surface px-1" />
                    {columns.map((contact) => (
                      <th key={contact} className="px-1 text-foreground/60 font-normal">
                        {contact}
                      </th>
                    ))}
                  </tr>
                  <tr data-testid={`matrix-row-${sectionKey}-${group}-${lineIdx}`}>
                    <th className="sticky left-0 bg-surface px-1 text-left text-foreground/80">
                      {group}
                    </th>
                    {columns.map((contact) => {
                      const cell = line.contacts.find((c) => c.contact === contact);
                      return (
                        <td
                          key={contact}
                          data-testid={`matrix-cell-${sectionKey}-${group}-${contact}`}
                          title={
                            cell ? `${group}${contact}: ${cell.voltage.toFixed(2)} µV` : undefined
                          }
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
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </section>
  );
}
