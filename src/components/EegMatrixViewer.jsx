import { Fragment, useMemo } from 'react';
import {
  buildElectrodeMatrix,
  splitChannelsByType,
  chunkContactsIntoLines,
  chunkArrayIntoLines,
  MATRIX_LINE_WIDTH,
} from '@/utils/eegTopographyUtils';
import { interpolateDivergingColor } from '@/utils/eegColormaps';

// Cell size in px. table-layout:auto (the default) sizes a column from the widest cell
// across *every* row sharing it, header included — so setting width only on the <td>s isn't
// enough, it'd just get overridden by the header <th>'s own content+padding. A <colgroup>
// with table-fixed pins every column's width independent of any row's content, and matches
// row-label-column width fixed to LABEL_COL_WIDTH.
const CELL_WIDTH = 28;
const CELL_HEIGHT = 20;
const LABEL_COL_WIDTH = 28;

// Renders EEG/SEEG electrode voltages as row(group)/column(number-within-group) matrices — one
// section per channel type, EEG first then SEEG below it, since a recording can mix both
// (channel type is user-editable per channel in the Montage Editor). A channel typed eeg/seeg
// but whose name doesn't fit a group+number shape (e.g. the 10-20 midline "Cz") still renders
// inside its own type's section, just as a named-column row with no group letter — it's still
// genuinely that type, so it doesn't belong under a separate heading. Only channels typed
// neither eeg nor seeg (e.g. ECG) get their own "Other" section at the bottom. See
// EegTopoViewer, which swaps this in for the Matrix tab. Pure channel-name-derived, no
// electrode position file needed (unlike the 3D connectome, which does).
export function EegMatrixViewer({ channelNames, voltages, channelTypes, colourBlindMode }) {
  const buckets = useMemo(
    () => splitChannelsByType(channelNames, voltages, channelTypes),
    [channelNames, voltages, channelTypes]
  );
  const eegMatrix = useMemo(
    () => buildElectrodeMatrix(buckets.eeg.names, buckets.eeg.voltages),
    [buckets.eeg]
  );
  const seegMatrix = useMemo(
    () => buildElectrodeMatrix(buckets.seeg.names, buckets.seeg.voltages),
    [buckets.seeg]
  );
  const otherEntries = useMemo(
    () => buckets.other.names.map((name, i) => ({ name, voltage: buckets.other.voltages[i] ?? 0 })),
    [buckets.other]
  );

  return (
    <div
      className="absolute inset-0 overflow-auto themed-scrollbar p-1"
      data-testid="eeg-matrix-viewer"
    >
      <MatrixSection
        sectionKey="eeg"
        title="EEG"
        groups={eegMatrix.groups}
        ungrouped={eegMatrix.ungrouped}
        colourBlindMode={colourBlindMode}
      />
      <MatrixSection
        sectionKey="seeg"
        title="SEEG"
        groups={seegMatrix.groups}
        ungrouped={seegMatrix.ungrouped}
        colourBlindMode={colourBlindMode}
      />
      <OtherSection entries={otherEntries} colourBlindMode={colourBlindMode} />
    </div>
  );
}

/**
 * One group(rows)/numberInGroup(columns) table for a single channel type. Wide groups wrap
 * onto multiple lines via chunkContactsIntoLines, sharing numberInGroup windows across the
 * whole section so number N aligns under the same header regardless of group. `ungrouped`
 * entries render as extra rows after the grouped ones — blank row label, name instead of a
 * number.
 *
 * @param {string} sectionKey - 'eeg' | 'seeg', used in data-testids
 * @param {string} title - section heading, e.g. "EEG"
 * @param {{ group: string, contacts: { numberInGroup: number, channelIdx: number, voltage: number }[] }[]} groups
 *   - from buildElectrodeMatrix
 * @param {{ channelIdx: number, name: string, voltage: number }[]} ungrouped - from buildElectrodeMatrix
 * @param {boolean} colourBlindMode
 */
function MatrixSection({ sectionKey, title, groups, ungrouped, colourBlindMode }) {
  // Own colour scale per section — EEG (scalp) and SEEG (depth) voltages typically differ by
  // an order of magnitude, so a single shared scale would wash out whichever type is smaller.
  // Ungrouped entries share it too, since they're genuinely the same channel type.
  const calMax = useMemo(
    () =>
      Math.max(
        1e-6,
        ...groups.flatMap((g) => g.contacts.map((c) => Math.abs(c.voltage))),
        ...ungrouped.map((e) => Math.abs(e.voltage))
      ),
    [groups, ungrouped]
  );

  if (groups.length === 0 && ungrouped.length === 0) return null;

  return (
    <section
      className="border-t border-border pt-2 mb-4 first:border-t-0 first:pt-0 last:mb-0"
      data-testid={`matrix-section-${sectionKey}`}
    >
      <h3 className="px-1 text-[13px] font-semibold text-foreground/70">{title}</h3>
      {/* table-fixed with no explicit table width would still stretch to fill its container,
          proportionally redistributing any extra space across the (equally-sized) columns —
          silently ignoring the actual CELL_WIDTH value. Pinning the table's own width to the
          sum of its columns is what makes the <colgroup> widths stick. */}
      <table
        className="table-fixed border-collapse text-[11px]"
        style={{ width: LABEL_COL_WIDTH + MATRIX_LINE_WIDTH * CELL_WIDTH }}
      >
        <colgroup>
          <col style={{ width: LABEL_COL_WIDTH }} />
          {Array.from({ length: MATRIX_LINE_WIDTH }, (_, i) => (
            <col key={i} style={{ width: CELL_WIDTH }} />
          ))}
        </colgroup>
        <tbody>
          {/* ─── Grouped rows: one group (e.g. "B", "E") per iteration, wrapped into
              numberInGroup lines via chunkContactsIntoLines — capped to each group's own max,
              not the section's, so a short group doesn't pad out to a longer one's line count. */}
          {groups.map(({ group, contacts }) =>
            chunkContactsIntoLines(contacts, Math.max(...contacts.map((c) => c.numberInGroup))).map(
              (line, lineIdx) => {
                const columns = Array.from(
                  { length: line.end - line.start + 1 },
                  (_, i) => line.start + i
                );
                return (
                  <Fragment key={`${group}-${lineIdx}`}>
                    {/* leading-none overrides index.css's inherited ~26px line-height, which would
                      otherwise floor the row height. pt-1.5 grows the row (a min, not a cap) to
                      add a gap above each header. */}
                    {/* header row: numberInGroup values for this line */}
                    <tr style={{ height: CELL_HEIGHT }}>
                      <th className="sticky left-0 bg-surface px-1 pt-1.5" />
                      {columns.map((numberInGroup) => (
                        <th
                          key={numberInGroup}
                          className="px-1 pt-1.5 text-foreground/60 font-normal leading-none"
                        >
                          {numberInGroup}
                        </th>
                      ))}
                    </tr>
                    {/* data row: group letter + one coloured cell per numberInGroup (blank = gap) */}
                    <tr
                      style={{ height: CELL_HEIGHT }}
                      data-testid={`matrix-row-${sectionKey}-${group}-${lineIdx}`}
                    >
                      <th className="sticky left-0 bg-surface px-1 text-left text-foreground/80 leading-none">
                        {group}
                      </th>
                      {columns.map((numberInGroup) => {
                        const cell = line.contacts.find((c) => c.numberInGroup === numberInGroup);
                        return (
                          <td
                            key={numberInGroup}
                            data-testid={`matrix-cell-${sectionKey}-${group}-${numberInGroup}`}
                            title={
                              cell
                                ? `${group}${numberInGroup}: ${cell.voltage.toFixed(2)} µV`
                                : undefined
                            }
                            style={{
                              backgroundColor: cell
                                ? interpolateDivergingColor(cell.voltage, calMax, colourBlindMode)
                                : 'transparent',
                            }}
                          />
                        );
                      })}
                    </tr>
                  </Fragment>
                );
              }
            )
          )}
          {/* ─── Ungrouped rows: this type's channels with no group+number shape (e.g. "Cz"),
              wrapped positionally via chunkArrayIntoLines. Blank row label; the column header
              is the channel's own name instead of a number. ─────────────────────────────── */}
          {chunkArrayIntoLines(ungrouped).map((line, lineIdx) => (
            <Fragment key={`ungrouped-${lineIdx}`}>
              {/* header row: channel names for this line */}
              <tr style={{ height: CELL_HEIGHT }}>
                <th className="sticky left-0 bg-surface px-1 pt-1.5" />
                {line.map((entry) => (
                  <th
                    key={entry.name}
                    className="px-1 pt-1.5 text-foreground/60 font-normal leading-none truncate"
                    title={entry.name}
                  >
                    {entry.name}
                  </th>
                ))}
              </tr>
              {/* data row: no group letter, one coloured cell per named entry */}
              <tr
                style={{ height: CELL_HEIGHT }}
                data-testid={`matrix-row-${sectionKey}-ungrouped-${lineIdx}`}
              >
                <th className="sticky left-0 bg-surface px-1" />
                {line.map((entry) => (
                  <td
                    key={entry.name}
                    data-testid={`matrix-cell-${sectionKey}-ungrouped-${entry.name}`}
                    title={`${entry.name}: ${entry.voltage.toFixed(2)} µV`}
                    style={{
                      backgroundColor: interpolateDivergingColor(
                        entry.voltage,
                        calMax,
                        colourBlindMode
                      ),
                    }}
                  />
                ))}
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// Channels typed neither eeg nor seeg (ECG, trigger, ...) — not part of either type's section,
// so they get their own catch-all here, one named column per channel. table-auto (not
// table-fixed like MatrixSection) so columns size to fit each name in full rather than
// truncating it — names here aren't constrained to the electrode-label lengths MatrixSection's
// ungrouped rows expect.
function OtherSection({ entries, colourBlindMode }) {
  const calMax = useMemo(
    () => Math.max(1e-6, ...entries.map((e) => Math.abs(e.voltage))),
    [entries]
  );

  if (entries.length === 0) return null;

  return (
    <section
      className="border-t border-border pt-2 mb-4 first:border-t-0 first:pt-0 last:mb-0"
      data-testid="matrix-section-other"
    >
      <h3 className="px-1 text-[11px] font-semibold text-foreground/70">Other</h3>
      <table className="border-collapse text-[11px]">
        <tbody>
          {chunkArrayIntoLines(entries).map((line, lineIdx) => (
            <Fragment key={lineIdx}>
              <tr style={{ height: CELL_HEIGHT }}>
                <th className="sticky left-0 bg-surface px-1 pt-1.5" />
                {line.map((entry) => (
                  <th
                    key={entry.name}
                    className="px-1 pt-1.5 text-foreground/60 font-normal leading-none whitespace-nowrap"
                  >
                    {entry.name}
                  </th>
                ))}
              </tr>
              <tr style={{ height: CELL_HEIGHT }} data-testid={`matrix-row-other-${lineIdx}`}>
                <th className="sticky left-0 bg-surface px-1" />
                {line.map((entry) => (
                  <td
                    key={entry.name}
                    data-testid={`matrix-cell-other-${entry.name}`}
                    title={`${entry.name}: ${entry.voltage.toFixed(2)} µV`}
                    style={{
                      backgroundColor: interpolateDivergingColor(
                        entry.voltage,
                        calMax,
                        colourBlindMode
                      ),
                    }}
                  />
                ))}
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </section>
  );
}
