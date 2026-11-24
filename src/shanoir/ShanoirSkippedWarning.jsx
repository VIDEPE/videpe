/**
 * The message of the warning toast after a Shanoir examination loaded: what wasn't shown, and
 * why. The toast is narrow, so the lines under each title are in a smaller font, and the
 * datasets are grouped by reason: each reason once, in bold, with its datasets under it.
 *
 * @param {Object} props
 * @param {{ name: string, reason: string, detail?: string }[]} props.skippedDatasets - see
 *   fetchShanoirExamination; `detail` goes in brackets after the name.
 * @param {{ name: string, source: string, reason: string }[]} props.skippedFiles - electrode
 *   positions, inverse solutions and montages not used because another file of the kind was.
 */
export function ShanoirSkippedWarning({ skippedDatasets, skippedFiles }) {
  // reason → its bullet lines, in the order the reasons first appear
  const linesByReason = new Map();
  for (const d of skippedDatasets) {
    const line = d.detail ? `- ${d.name} (${d.detail})` : `- ${d.name}`;
    linesByReason.set(d.reason, [...(linesByReason.get(d.reason) ?? []), line]);
  }

  return (
    <div>
      {skippedDatasets.length > 0 && (
        <>
          <p>Skipped the following datasets:</p>
          <div className="text-xs">
            {[...linesByReason].map(([reason, lines]) => (
              <div key={reason}>
                <p className="font-semibold">{reason}:</p>
                <ul>
                  {/* names can repeat (e.g. two BIDS folders' electrodes.tsv): key by position */}
                  {lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
      {skippedFiles.length > 0 && (
        <>
          <p>Skipped the following files:</p>
          <ul className="text-xs">
            {skippedFiles.map((f, i) => (
              <li key={i}>{`- ${f.name} from ${f.source} (${f.reason})`}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
