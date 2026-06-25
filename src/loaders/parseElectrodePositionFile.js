import { parseElcElectrodePositions } from './parseElcElectrodePositions';
import { parseTsvElectrodePositions } from './parseTsvElectrodePositions';

// Reads an electrode position file and dispatches to the right parser by extension.
// Single place for this dispatch so it isn't duplicated between PatientView's file
// dropzone and EegViewer/EegTopoViewer's own "use custom positions" entry points.
//
// @param {File} file
// @returns {Promise<{ electrodes: object[], fiducials: object, hasFiducials: boolean }>}
export async function parseElectrodePositionFile(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (extension === 'elc') return parseElcElectrodePositions(await file.text());
  if (extension === 'tsv') return parseTsvElectrodePositions(await file.text());
  throw new Error(`Unsupported electrode position file type: .${extension}`);
}
