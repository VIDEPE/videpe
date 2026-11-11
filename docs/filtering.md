# Frequency filtering

This guide is for developers working on VIDEPE's EEG filtering. It explains how the filters are designed, where each setting comes from, how the global filters and a montage row's own filters combine, and why it works this way.

## Overview

Filters are set per **row**: one trace in the EEG viewer. Without a montage, there is one row per (non-bad) channel. With a montage, each row is a montage row: a channel, optionally minus a reference (another channel, or the average or median), so `Fp1 − F7` is one row. Several montage rows can use the same channel.

Each row can have three filters: a high-pass, a low-pass and a mains notch. Each is a frequency in Hz, or `null` for off.

The values come from two places:

| Setting             | Where it's set                         | Applies to                  | Stored in                                                                                                              |
| ------------------- | -------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Global filters      | Filters button → Global Filters window | Every row of a channel type | `globalFilters` state in `EegViewer`                                                                                   |
| A row's own filters | Montage Editor, per montage row        | That one row only           | `highPass` / `lowPass` / `notch` on each row of the `montageChannels` state in `EegViewer` (from `useMontageChannels`) |

The global filters are the standard way to filter. A row's own filters can be used if the user wants to set custom settings per row, e.g. a different high-pass on an ECG row with stronger baseline drift than others.

### Drafts

Neither the Global Filters window nor the Montage Editor edits the live state directly. Each one copies the current settings into a draft when it opens, edits only that draft, and commits it to the live state on Apply or OK:

| Window         | Live state (in `EegViewer`)          | Draft                                          | Committed by                                       |
| -------------- | ------------------------------------ | ---------------------------------------------- | -------------------------------------------------- |
| Global Filters | `globalFilters`                      | `draftGlobalFilters`                           | `onApplyGlobalFilters`                             |
| Montage Editor | `montageChannels`, `channelSettings` | `draftMontageChannels`, `draftChannelSettings` | `onApplyMontageChannels`, `onApplyChannelSettings` |

- **Apply** commits the draft and keeps the window open; **OK** commits and closes; **Cancel** (or the red close button) closes without committing.
- **A fresh draft on every open.** `EegViewer` only renders a window while it's open, so it remounts each time and seeds its draft from the current live state. No reset logic is needed.
- **Unsaved changes are marked.** While a draft differs from the live state, the window's title gets a `*` and Apply is highlighted.
- **Everything in the window is part of the draft,** including the bulk "set all" controls, Clear all and Reset to global. "Reset to global" is a pending flag in the Global Filters window that only clears the rows' own filters (through `onApplyMontageChannels`) on Apply/OK.
- **The two windows don't share a draft.** That's why "Reset to global" is disabled while the Montage Editor is open: the editor's own draft, committed later, would overwrite the reset.
- **The montage editor reads the draft type.** Its placeholders and its AnyWave save use the type from `draftChannelSettings`, so they follow a type change before it's applied. The global filters it shows are the live ones, though, not an unapplied draft in the Global Filters window.

## How a row's filters are resolved

`resolveRowFilters(row, globalFilters[type])` in `src/utils/eegFilters.js` decides the effective value of each filter:

- **A row's own value wins.** Any number, including 0, overrides the global value.
- **`null` on the row means "follow global".** The row then gets the global value of its channel type, which may itself be `null` (off).
- **Each field is resolved on its own.** A row with only its own high-pass still follows the global low-pass and notch.

Rules that decide which global filters a row gets:

- **The type comes from the row's channel.** A bipolar row `Fp1 − F3` uses `Fp1`'s type, not the reference's.
- **A channel without a type counts as `eeg`.** This is the same fallback used everywhere else.
- **Without a montage, every channel follows global.** Each non-bad channel gets one row, and nothing overrides the global filters.

`buildMontageDisplayRows` (`src/utils/eegViewerUtils.js`) calls the resolver, so the display rows carry the effective values. Filtering and the active-state check only ever look at those resolved values.

## Global filters per channel type

- **Only one global set per type.** The types are those in `TYPE_LIST` (`src/utils/channelTypes.js`): currently `eeg`, `seeg` and `other`. `DEFAULT_GLOBAL_FILTERS` has every filter off for every type.
- **New types appear automatically.** `DEFAULT_GLOBAL_FILTERS`, the Global Filters window and the montage editor's type options are all built from `TYPE_LIST`, so a type added there needs no other changes.
- **Types without channels are dimmed, not disabled.** The window shows a channel count per type (`countChannelsByType`). A type with 0 channels is dimmed, because its filter has no effect, but stays editable so its filters can be set before channels are switched to that type.

## Filter design

Coefficients come from the [fili](https://github.com/markert/fili.js) library and are applied in `applyFilterSections`.

| Filter    | Design                                    | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High-pass | 8th-order Butterworth (4 biquads)         | Butterworth is maximally flat: its gain falls smoothly and monotonically from passband to stopband, so it has no ripple in either (unlike Chebyshev or elliptic designs, which trade ripple for a steeper slope). The order builds up as follows: fili's `order: 4` cascades 4 biquads, each a 2nd-order section, so the design is 8th order (48 dB/octave); `filtfilt` runs it forward and backward, doubling the attenuation to an effective 16th order (96 dB/octave). That's steeper than needed and adds ringing around sharp transients; lowering it to a 4th-order design (`order: 2`) is planned |
| Low-pass  | 8th-order Butterworth (4 biquads)         | Same as high-pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Notch     | Butterworth bandstop, 1 biquad, `BW: 0.1` | In fili, extra bandstop sections widen the stopband instead of steepening it (4 sections spanned ~20–120 Hz around 50 Hz). One narrow section is ~3 Hz wide at −3 dB around 50 Hz. `BW` is the stopband width in octaves, so 0.1 octave is ~3.5 Hz at 50 Hz and widens with the notch frequency                                                                                                                                                                                                                                                                                                          |

Further decisions:

- **No separate band-pass design.** High-pass, low-pass and notch are independent linear filters, so `buildFilterSections` just concatenates their sections into one cascade. The order doesn't change the result.
- **Zero-phase.** The cascade runs forward and backward (`filtfilt`), so waveforms aren't shifted in time. This squares the magnitude response: the attenuation in dB doubles, and the cutoff lies at about −6 dB instead of −3 dB.
- **Edge handling.** `filtfilt` has no padding of its own, and the buffer edges would ring. `applyMontageRowFilter` therefore zero-pads each row by 1 second (split before and after) and multiplies it with a Tukey window (`alpha = 0.1`) before filtering, which softens the jump at the edges. The padding is removed afterwards.
- **No filter, no work.** A row whose filters are all `null` is returned unchanged, without building a window.

## Where filtering runs in the pipeline

Per buffered stretch of the recording, `EegViewer` runs:

1. **Reference.** Each row's signal is derived first: the channel minus its reference channel, or minus the average or median of the non-bad channels.
2. **Filter.** `filterMontageRows` filters every display row's full buffer. This can take seconds for a large montage, so it works in pauseable steps, and a newer run cancels the previous one. Until it finishes, the previous result stays on screen.
3. **Downsample.** The filtered signal is downsampled for the current viewport. Panning, zooming and resizing only redo this step, never the filtering.

Filtering re-runs when the data, the display rows or the reference series change. Because the resolved filter values are part of the display rows, changing a global filter or a row's own filter re-filters too.

**Note:** The filters currently only affect the EEG traces. The topography, the 3D connectome and ESI take their voltages at the selected time point from the raw, unfiltered buffer (`channels`, via `useTimepointSnapshot`). Passing the filtered data to them is the next planned feature.

## Input rules

Both windows clamp the same way, on blur rather than on every keystroke, so typing `100` isn't cut off at `1` first:

- **High-pass:** between 0 and its own low-pass (or the Nyquist frequency when the low-pass is off).
- **Low-pass:** between its own high-pass (or 0) and the Nyquist frequency.
- **Notch:** between 0 and the Nyquist frequency.
- **An empty field is `null` (off),** never clamped to 0.

The bulk "set all" control above each column in the Global Filters window clamps per type, against that type's own other filters. An empty bulk field turns that filter off for every type.

0 is a valid value and counts as "on", because only `null` means off. A 0 Hz low-pass is therefore applied, even though it isn't useful. Making 0 mean off is an open decision.

## How the settings influence each other

| Action                                           | Effect                                                                                                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change a global filter                           | Every row of that type without its own value for that filter follows. Rows with their own value don't change.                                                          |
| Give a row its own value                         | Only that row and that filter change. Its other filters still follow global.                                                                                           |
| Change a channel's type                          | All rows of that channel switch to the new type's global filters. In the montage editor, the placeholders follow the draft type right away.                            |
| Clear all (Global Filters window)                | All global filters off, in the draft. The rows' own filters stay.                                                                                                      |
| Reset to global (Global Filters window)          | Clears every montage row's own filters on Apply/OK, so all rows follow global. Disabled while the montage editor is open, because its draft would overwrite the reset. |
| Save an AnyWave montage                          | Writes each row's **effective** filters (own or global), so the file filters the same as the viewer.                                                                   |
| Load an AnyWave montage                          | Its filter values become the rows' **own** filters. Off values (`-1` for high/low-pass, `0` for notch) become `null`, so those follow global.                          |
| Load a Cartool montage or pick a preset template | Rows have no filters of their own, so they follow global.                                                                                                              |

Two consequences to be aware of:

- **A saved and reloaded montage no longer follows global.** Saving bakes the global values into the file, and loading turns them into the rows' own values. Later changes to the global filters then don't reach those rows. "Reset to global" undoes this.
- **The montage editor shows what a row inherits.** An empty filter field shows the global value for the row's type as a greyed placeholder.

## Showing that filters are active

- **The Filters button** is filled when at least one displayed row is filtered (`hasActiveFilters` on the resolved display rows), and outlined otherwise. So a row's own filter lights it up even when every global filter is off, and a global filter for a type without channels doesn't.
- **The Montage button** is filled when a montage is set.
- **The Global Filters window** lists how many montage rows have their own filters, with "Reset to global" next to it, so the user can see why the Filters button is lit when the global values are empty.

## Code

| What                                                         | Where                                                                   |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Coefficients, cascade, filtfilt, Tukey window                | `src/utils/eegFilters.js`                                               |
| `resolveRowFilters`, `hasActiveFilters`                      | `src/utils/eegFilters.js`                                               |
| `TYPE_LIST`, `DEFAULT_GLOBAL_FILTERS`, `countChannelsByType` | `src/utils/channelTypes.js`                                             |
| `buildMontageDisplayRows`, `filterMontageRows`               | `src/utils/eegViewerUtils.js`                                           |
| Global Filters window                                        | `src/components/EegGlobalFiltersEditor.jsx`                             |
| Per-row filters, placeholders, AnyWave save                  | `src/components/EegMontageEditor.jsx`                                   |
| AnyWave read/write                                           | `src/loaders/parseMontageAnywave.js`, `src/loaders/toMontageAnyWave.js` |
