import { useState, useEffect } from 'react';
import { parseMontageFile } from "@/loaders/parseMontageFile"
import toast from 'react-hot-toast';
// JSON path with the montage templates
const TEMPLATE_MONTAGES_PATH = "montage_files/TEMPLATE_MONTAGES.json"


export function useMontageTemplates() {
    const [ montageTemplates, setMontageTemplates ] = useState([])
        
    useEffect(() => {
        // effects can't be `async` themselves, so wrap the actual work in an inner function
        async function loadTemplates() {
            // 1. fetch + parse TEMPLATE_MONTAGES_PATH → `sources` (array of {name, path})
            let sources;
            try {
                const listText = await fetch(TEMPLATE_MONTAGES_PATH).then((response) => response.text());
                sources = JSON.parse(listText);
            } catch {
                return; // TEMPLATE_MONTAGE_PATH could not be read, montageTemplate stays at initial []
            }

            // 2. for each source, parseMontageFile(source.path) — catch failures per-item
            //    so one bad file doesn't stop the rest, toast.error on failure, skip that entry
            let templateArray = []
            for (let iSource = 0; iSource < sources.length; iSource++) {
                const source = sources[iSource];
                try {
                    const {rows, channelTypes} = await parseMontageFile(source.path)
                    templateArray.push({"name": source.name,
                                        "path": source.path,
                                        rows,
                                        channelTypes,
                                    })
                } catch (err) {
                toast.error(`Failed to load montage template "${source.name}": ${err.message}`);
                }
            // 3. store loaded templateArray in the state
            setMontageTemplates(templateArray)
        }
        }
    loadTemplates();
    }, []); // empty deps — template files are static, fetched once on mount

    return montageTemplates
}