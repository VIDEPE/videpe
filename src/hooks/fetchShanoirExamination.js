import { classifyDataset } from '../loaders/shanoirFiles';
import {unzipToFiles } from '../loaders/unzipToFiles';
import { selectEegIntakeFile, selectImagingFiles, selectExtraDataFileNames } from '../loaders/shanoirFiles';


export async function fetchShanoirExamination({ client, examinationId, signal }) {
  const [datasets, examination] = await Promise.all([
    client.listExaminationDatasets(examinationId, signal),
    client.getExamination(examinationId, signal),
  ]);
  
  datasets.forEach((dataset) => {
    // TODO: group datasets with classifyDataset → eeg / imaging / skipped
    // TODO: download + unzip each (Promise.all), selectEegIntakeFiles on the EEG ones
    // TODO: extra-data: selectExtraDataFileNames → downloadExtraData, add to eegFiles
    if (classifyDataset(dataset) === 'eeg') {
        // download EEG data
        const eegFiles = selectEegIntakeFiles(unzipToFiles(dataset))
    } else if (classifyDataset(dataset) === 'imaging') {
        const imagingFiles = selectImagingFiles(unzipToFiles(dataset))
    }
    else throw new Error(`Unable to classify dataset with type ${classifyDataset(dataset)}`)
  })
  
  
  return { eegFiles, imagingFiles, skipped };
}
