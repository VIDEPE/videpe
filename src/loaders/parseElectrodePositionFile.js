import { parseElectrodePositionElc } from './parseElectrodePositionElc';
import { parseElectrodePositionTsv } from './parseElectrodePositionTsv';

// Reads an electrode position file and dispatches to the right parser by extension.
// Single place for this dispatch so it isn't duplicated between PatientView's file
// dropzone and EegViewer/EegTopoViewer's own "use custom positions" entry points.
//
// @param {File} file
// @returns {Promise<{ electrodes: object[], fiducials: object, hasFiducials: boolean }>}
export async function parseElectrodePositionFile(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (extension === 'elc') return parseElectrodePositionElc(await file.text());
  if (extension === 'tsv') return parseElectrodePositionTsv(await file.text());
  throw new Error(`Unsupported electrode position file type: .${extension}`);
}
