# Electrode Positions

## fsaverage_1005.tsv

This file is sourced from [MNE-Python](https://mne.tools/), an open-source Python package for processing MEG and EEG data.

- **Licence:** [BSD 3-Clause](https://opensource.org/licenses/BSD-3-Clause)
- **Software DOI:** [10.5281/zenodo.592483](https://doi.org/10.5281/zenodo.592483)

### Changes from the original

- Added `T1` and `T2` at the positions of `FT9` and `FT10`, offset by 1 nm along each of x, y and z so they are not exact duplicates (exact duplicates are left out of the topography mesh). T1/T2 are anterior temporal electrodes common in clinical (epilepsy) recordings but not part of the 10-05 template; FT9/FT10 are the closest standard positions, so recordings that use T1/T2 still get matched to a position.

If you use this file in your work, please cite MNE-Python:

> Gramfort, A., Luessi, M., Larson, E., Engemann, D.A., Strohmeier, D., Brodbeck, C., Goj, R., Jas, M., Brooks, T., Parkkonen, L., and Hämäläinen, M.S. MEG and EEG data analysis with MNE-Python. _Frontiers in Neuroscience_, 7(267):1–13, 2013. doi:[10.3389/fnins.2013.00267](https://doi.org/10.3389/fnins.2013.00267)

## FieldTrip-based template electrode files

These files are sourced from [FieldTrip](https://www.fieldtriptoolbox.org/), an open-source MATLAB package for processing MEG and EEG data, from its `template/electrode` folder:

| File                         | FieldTrip original     |
| ---------------------------- | ---------------------- |
| standard_1020.tsv            | `standard_1020.elc`    |
| template_EGI128_prefix_E.tsv | `GSN-HydroCel-129.sfp` |
| template_EGI128.tsv          | `GSN-HydroCel-129.sfp` |
| template_EGI256_prefix_E.tsv | `GSN-HydroCel-257.sfp` |
| template_EGI256.tsv          | `GSN-HydroCel-257.sfp` |

- **Licence:** [GPL3](https://www.gnu.org/licenses/gpl-3.0)
- **Software DOI:** [10.5281/zenodo.10495174](https://doi.org/10.5281/zenodo.10495174)

### Changes from the original

- **All files:** Converted to tsv. The EGI files leave out the fiducials (`FidNz`, `FidT9`, `FidT10`).
- **Offsets:** Names at the same position are 1 nm apart along each of x, y and z, so they are not exact duplicates (exact duplicates are left out of the topography mesh). The number in the file differs per unit: these files use mm, except the EGI 128 files, which use cm.
- **standard_1020.tsv:** Added `T1` and `T2` at the positions of `FT9` and `FT10`, offset as above. See [fsaverage_1005.tsv](#fsaverage_1005tsv) for why T1/T2 are added. Also offset `T3`, `T4`, `T5` and `T6` as above: they are the old names of `T7`, `T8`, `P7` and `P8`, which FieldTrip lists at the exact same positions.
- **template_EGI128_prefix_E.tsv:** Added `VREF` at the position of `Cz`, offset as above. EGI recordings label the reference electrode either `Cz` or `VREF`, so both get matched to a position.
- **template_EGI128.tsv:** Same as template_EGI128_prefix_E.tsv, with the `E` prefix removed from the channel labels (`E1` → `1`), for recordings that label channels with bare numbers.
- **template_EGI256_prefix_E.tsv:** Converted from cm to mm, and rotated/shifted into a different head coordinate frame; the electrode layout itself is unchanged. Added `E257` and `VREF` at the position of `Cz`, the net's reference electrode, offset 1 nm in opposite directions from it. EGI recordings label that electrode in any of these three ways, so each gets matched to a position.
- **template_EGI256.tsv:** Same as template_EGI256_prefix_E.tsv, with the `E` prefix removed from the channel labels (`E1` → `1`), for recordings that label channels with bare numbers, and its coordinates rounded to fewer decimals.

If you use one of these files in your work, please cite FieldTrip:

> Oostenveld R, Fries P, Maris E, Schoffelen JM. FieldTrip: Open Source Software for Advanced Analysis of MEG, EEG, and Invasive Electrophysiological Data. Comput Intell Neurosci. 2011;2011:1-9. [doi:10.1155/2011/156869](https://doi.org/10.1155/2011/156869)
