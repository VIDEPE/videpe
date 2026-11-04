# Electrode Positions

## fsaverage_1005.tsv

This file is sourced from [MNE-Python](https://mne.tools/), an open-source Python package for processing MEG and EEG data.

- **Licence:** [BSD 3-Clause](https://opensource.org/licenses/BSD-3-Clause)
- **Software DOI:** [10.5281/zenodo.592483](https://doi.org/10.5281/zenodo.592483)

### Changes from the original

- Added `T1` and `T2` at the positions of `FT9` and `FT10`, with the last decimals dropped so they are not exact duplicates (exact duplicates are left out of the topography mesh). T1/T2 are anterior temporal electrodes common in clinical (epilepsy) recordings but not part of the 10-05 template; FT9/FT10 are the closest standard positions, so recordings that use T1/T2 still get matched to a position.

If you use this file in your work, please cite MNE-Python:

> Gramfort, A., Luessi, M., Larson, E., Engemann, D.A., Strohmeier, D., Brodbeck, C., Goj, R., Jas, M., Brooks, T., Parkkonen, L., and Hämäläinen, M.S. MEG and EEG data analysis with MNE-Python. _Frontiers in Neuroscience_, 7(267):1–13, 2013. doi:[10.3389/fnins.2013.00267](https://doi.org/10.3389/fnins.2013.00267)

## FieldTrip-based template electrode files

The EGI template files are sourced from [FieldTrip](https://www.fieldtriptoolbox.org/), an open-source MATLAB package for processing MEG and EEG data.

- **Licence:** [GPL3](https://www.gnu.org/licenses/gpl-3.0)
- **Software DOI:** [10.5281/zenodo.10495174](https://doi.org/10.5281/zenodo.10495174)

If you use one of these files in your work, please cite FieldTrip:

> Oostenveld R, Fries P, Maris E, Schoffelen JM. FieldTrip: Open Source Software for Advanced Analysis of MEG, EEG, and Invasive Electrophysiological Data. Comput Intell Neurosci. 2011;2011:1-9. [doi:10.1155/2011/156869](https://doi.org/10.1155/2011/156869)