# Channel mapping

This guide is for anyone who wants VIDEPE to work with a recording's channel names: someone checking whether their recordings are covered, or a developer adding a new EEG cap. It explains how VIDEPE links a channel name to an electrode position and to the bundled montages, how to set that up for a new naming system, and why it works this way.

## How it works

A recording's channel names go through two separate lookups. Both compare names only, and they don't depend on each other.

| Lookup              | Question it answers                                   | Data it uses                                               | Code                                                          |
| ------------------- | ----------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| Electrode positions | Where on the head is this channel?                    | `src/assets/electrode_positions/*.tsv`                     | `src/hooks/useElectrodeMatching.js`                           |
| Montages            | What is this montage channel called in the recording? | `src/assets/montage_files/*.mtg` and `channel_maps/*.json` | `src/hooks/useMontageTemplates.js`, `remapMontageToRecording` |

1. VIDEPE compares the recording's channel names with every bundled position template and picks the best one: the most matched channels, and on a tie the highest share of the template's positions used. Spelling is forgiving: before comparing, VIDEPE removes a leading `EEG ` or `MEG `, removes everything from the first dash onwards, and ignores upper and lower case. So `FP1`, `EEG Fp1-Ref` and `Fp1-A1` all match `Fp1`. Any other difference counts as a different name, so `EEG_Fp1` and `Fp 1` don't match.
2. The chosen template's id is looked up in `MONTAGE_NAMING_SYSTEMS`. That entry says whether montages are offered, which prefix they get in the dropdown, and which channel aliases apply.
3. Each montage is translated to the recording's names. For each name in the montage, VIDEPE uses the recording's own channel if it has one, otherwise the alias if the recording has that, and otherwise leaves the name unchanged.
4. A montage is offered if at least one of its rows can be drawn. Rows that can't be drawn are left out, so a montage can be partly drawn.

## Is your recording already covered?

| Channel names                                     | Position template                               | Bundled montages                                 |
| ------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| 10-20 or 10-05 names, modern (`T7`) or old (`T3`) | `standard_1020` or `fsaverage_1005`             | Yes                                              |
| EGI 256: `E1`–`E256`, plus `Cz` or `VREF`         | `template_EGI256_prefix_E`                      | Yes, shown as `EGI 256 - ...`                    |
| EGI 256: `1`–`256`, plus `Cz` or `VREF`           | `template_EGI256`                               | Yes, shown as `EGI 256 - ...`                    |
| EGI 128: `E1`–`E128` or `1`–`128`                 | `template_EGI128_prefix_E` or `template_EGI128` | No, only None and CAR (common average reference) |
| SEEG                                              | None, load your own positions                   | No                                               |

You can see the result in the EEG viewer: the Electrode Position status LED shows how many channels were matched, and the Montage dropdown lists what built-in montage templates are available. The Montage Editor (clicking the 'Montage' button) also shows per channel which have a position mapped.

### Without changing any code

If your channel names aren't covered, you can still use VIDEPE with your own files as long as the [file format is supported](../README.md#supported-formats):

- **Positions:** load an `.elc` or `*_electrodes.tsv` file. It replaces the template for positions. It doesn't change which montages are offered, because those still depend on the best-matching bundled template relating to the recording channel names.
- **Montages:** load an AnyWave or Cartool montage file in the Montage Editor. Its names must match the recording's channel names. Differences in spelling are handled, but channel aliases are not applied to loaded files.

## Adding a new naming system

Follow these steps to make VIDEPE recognise a new EEG cap, here called `MyCap`, and offer it the bundled montages.

**1. Add the position template.** Create `src/assets/electrode_positions/template_MyCap.tsv`, tab-separated, with a header and one electrode per line:

```
name	x	y	z
A1	71.03793959	31.26694019	-9.194839807
```

Use `name` or `label` as the first column's header. Use mm if you can. Metres and cm work too, because VIDEPE can infer the unit from the coordinates' range. Write down the file's source and every change you made in that folder's `README.md`, including the licence.

**2. Check for names at the same position.** Each name a recording can use needs its own line. If two names share a position, offset one of them as described in [Names at the same position](#names-at-the-same-position).

**3. Register the template.** In `src/hooks/useElectrodeMatching.js`, import the file with `?raw` and add it to `STANDARD_TEMPLATES`. Use the file name without `.tsv` as the `id`. The `name` is the text users see.

**4. Add the channel map.** Montage files are written in 10-20 names, so add `src/assets/montage_files/channel_maps/10-20_to_MyCap.json`, which gives your cap's name for each 10-20 name:

```json
{
  "Fp1": "A1",
  "Fp2": "A2"
}
```

A map is only needed if your cap uses other names than the montages do. If it uses 10-20 names already, reuse `10-20_to_old_names.json`, as `standard_1020` does.

**5. Connect them.** In `src/hooks/useMontageTemplates.js`, add the template's id to `MONTAGE_NAMING_SYSTEMS`:

```js
template_MyCap: { namePrefix: 'MyCap - ', channelAliases: tenTwentyToMyCap },
```

A template that isn't listed here gets no montages. That's deliberate: leaving a cap out is how you keep unverified montages away from it.

**6. Add tests.** These run automatically for a new template:

- every line of the file has a name and three coordinates
- every electrode ends up in the topography mesh
- template ids are unique
- the keys of `MONTAGE_NAMING_SYSTEMS` exist as templates

Add these yourself, using `src/test/hooks/useElectrodeMatching.test.js` and `src/test/hooks/useMontageTemplates.test.js` as examples:

- a recording with your cap's names selects your template
- your map has the expected number of entries, each pointing to a different electrode
- every row of every montage can be drawn for a full recording

**7. Check the map against its source.** Tests catch typos and duplicates, but they can't tell whether `Fp1` really is `A1`. Have someone who knows the cap check this before release. A wrong pair draws a plausible trace from the wrong electrode.

## Development Decisions

### Names are matched, not positions

Montage rows and position templates are both looked up by name. A position lookup can't tell a montage that `T7` is called `T3` in this recording, so these are solved separately: position templates list every name, and channel aliases translate montages.

### Trace names stay as they are in the recording

Aliases only decide which channel a montage row reads from. A row written as `T7-P7` shows as `T3-T5` on a recording with the old names, and as `E69-E96` on an EGI 256 recording, so users see the names from their own file.

This keeps the user responsible for the naming and mapping of their recording. If VIDEPE overwrote the recording's channel names, it could show wrong names for a recording from a system VIDEPE doesn't know.

### One set of montages, translated per cap

The montages exist once, in 10-20 names, instead of as a copy per cap and per spelling. Translating the 10-20 montages reproduced the original E-named files exactly, including colours. The number-named files differed in only one way, which is the `Cz`/`VREF` decision below.

### The recording's own name wins over an alias

If a recording has both `T7` and `T3`, the montage uses `T7`. This also makes `Cz` work: a recording with `Cz` uses it, and one with only `VREF` gets the alias.

### Old 10-20 names are aliased

`T3`, `T4`, `T5` and `T6` are the old names of `T7`, `T8`, `P7` and `P8`. Recordings with the old names would otherwise lose their temporal rows, so both `standard_1020` and `fsaverage_1005` use `10-20_to_old_names.json`.

### `Cz` is added in code for EGI 256

`10-20_to_EGI256.json` has 69 pairs, and `buildEgi256ChannelNames` adds `Cz: 'VREF'` as the 70th. `Cz` is the net's reference electrode, so it has no regular number from 1 to 256. In the JSON it would get the prefix and turn into `EVREF`. The E-named and number-named tables are built from the same JSON, so the pairs exist only once.

### `E257` and `257` are not aliased

As far as we know, raw EGI data uses 257 for the reference electrode, but the conversion software we know writes `Cz` or `VREF`. VIDEPE reads no `.mff` files, only converted recordings, so these names are unlikely to reach it. The templates list them, so such a channel would still get a position, but it would lose the 1 or 2 montage rows per montage that use `Cz`. Each name has only one alias, so supporting this would take a list of aliases: `Cz: ['VREF', 'E257']`. Add that if a real recording turns up with these names, or if VIDEPE gets an `.mff` loader.

### EGI 128 gets no montages yet

`E1`–`E128` also exist in the 256 net, but at different positions, so the 256 map can't be reused. EGI 128 keeps only None and CAR until its montages have been verified.

### SEEG gets no montage templates

Depth electrode names have no relation to the 10-20 system, so SEEG recordings never get file templates, even if their channel names happen to look like 10-20 names.

## Names at the same position

Some electrodes have more than one name. Every name has its own line in the template, because a recording can use any of them. Those lines are 1 nm apart along each of x, y and z.

### Why an offset is needed

The topography mesh is built from the whole template, not only from the recording's channels. `buildElectrodeMesh` projects the electrodes onto a sphere and takes the convex hull, which is what turns them into triangles. Two electrodes in the same direction from the centre are one point to the hull, so one of them is discarded. If that's the name your recording uses, its voltage is missing from the mesh. VIDEPE only logs a console warning in that case.

Removing one of the names isn't an option either, because a recording using that name would then have no position.

### Why 1 nm

- **It's a physical distance.** Files use different units, so a fixed number would mean a different distance per file. One physical distance is the same everywhere and easy to explain.
- **It's far too small to matter.** Electrode positions aren't known anywhere near that precisely, and nobody can see it.
- **It replaces arbitrary values.** Before this, each pair had its own hand-picked offset, some of them up to 0.34 mm.
- **It's the same on all three axes.** No direction is special, so none is preferred. The real distance between two names is about 1.7 nm (√3 × 1 nm).

The mesh calculates in double precision, so 1 nm isn't rounded away there.

A bigger offset isn't automatically safer: during testing, one offset of 0.01 mm dropped `Cz` while smaller and larger values were fine. What makes this safe is the test that runs every bundled template through the real mesh code, not the number itself. Rounding a template's coordinates can also remove the offset, and that test catches it.

### How to write it

| File                   | Unit | 1 nm is written as |
| ---------------------- | ---- | ------------------ |
| `fsaverage_1005.tsv`   | m    | `0.000000001`      |
| `standard_1020.tsv`    | mm   | `0.000001`         |
| `template_EGI128*.tsv` | cm   | `0.0000001`        |
| `template_EGI256*.tsv` | mm   | `0.000001`         |

Keep the source's name at its original position, and offset the name you added. Put the names on adjacent lines, so the pair is easy to spot.

### Which names are offset

| File                                      | Stays at the source's position | Offset by 1 nm                                       |
| ----------------------------------------- | ------------------------------ | ---------------------------------------------------- |
| `standard_1020.tsv`                       | `T7`, `T8`, `P7`, `P8`         | `T3`, `T4`, `T5`, `T6`                               |
| `standard_1020.tsv`, `fsaverage_1005.tsv` | `FT9`, `FT10`                  | `T1`, `T2`                                           |
| `template_EGI128*.tsv`                    | `Cz`                           | `VREF`                                               |
| `template_EGI256*.tsv`                    | `Cz`                           | `E257` (`257`) and `VREF`, on opposite sides of `Cz` |

### When not to offset

Offset only names that refer to the same position. `NAS`/`Nz` and `INI`/`Iz` in `fsaverage_1005.tsv` sit close together, but they're separate landmarks with their own positions, so they are left alone.

`T1` and `T2` are the one exception. They aren't other names for `FT9` and `FT10`, but they aren't in the source templates, and those are the closest standard positions. So they share a position in the files and get the same offset.

### What the offset doesn't do

It only keeps electrodes in the mesh. Montages don't read positions, so a montage still needs an alias to find a channel under another name.

## Known limits

- **The EGI 256 map is unverified:** the 69 pairs and the montages' electrode chains come from the original `.mtg` files, and haven't been checked against EGI's own documentation.
- **Custom position files aren't protected:** they go through the same mesh code but not the template tests, so a file with two names at one position loses an electrode with only a console warning.
- **Recordings with both `Cz` and `VREF`:** these are two names for one electrode, so they only differ by the [1 nm offset](#names-at-the-same-position): about 1.7 nm apart in the EGI 128 templates and 3.5 nm in the EGI 256 templates, where a third name also needs its own spot. How the voltage interpolation behaves with two channels that close together hasn't been checked.
