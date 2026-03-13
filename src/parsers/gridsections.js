/**
 * Parser for multi-section grid plate files (e.g., 20250605_Soil_GFP.xlsx).
 * Format:
 *   Section header row: [sectionLabel, 1, 2, ..., N, extra...]
 *   Data rows:          [rowLetter, val1, val2, ..., valN, extra...]
 *   Multiple sections may follow, separated by blank rows.
 *
 * ALL numeric sections are parsed and returned as an array of datasets.
 * Text sections (e.g. "Ratio") are skipped automatically (values not numeric).
 */

const PLATE_SIZE_FORMATS = [
  { size: 6,   maxRowOrd: 2,  maxCol: 3  },
  { size: 24,  maxRowOrd: 4,  maxCol: 6  },
  { size: 96,  maxRowOrd: 8,  maxCol: 12 },
  { size: 384, maxRowOrd: 16, maxCol: 24 },
]

function inferPlateSize(wellData) {
  const positions = Object.keys(wellData).filter(p => /^[A-P]\d+$/.test(p))
  if (!positions.length) return 96
  const maxRowOrd = Math.max(...positions.map(p => p.charCodeAt(0) - 64))
  const maxCol    = Math.max(...positions.map(p => parseInt(p.slice(1))))
  for (const { size, maxRowOrd: mr, maxCol: mc } of PLATE_SIZE_FORMATS) {
    if (maxRowOrd <= mr && maxCol <= mc) return size
  }
  return 384
}

// Parse wavelength info from a section label like "GFP 480/520", "rhod 560", "FITC 490"
function parseWavelengths(label) {
  const exEm = label.match(/(\d{3})\s*[\/\-]\s*(\d{3})/)
  if (exEm) return [`${exEm[1]}/${exEm[2]}`]
  const single = label.match(/\b(\d{3})\b/)
  if (single) return [single[1]]
  return []
}

// Parse read type from section label
function parseReadType(label, allVals) {
  const l = label.toLowerCase()
  if (l.includes('lum')) return 'luminescence'
  const maxVal = allVals.length ? Math.max(...allVals) : 0
  if (maxVal > 1e5) return 'luminescence'
  if (maxVal > 5)   return 'fluorescence'
  return 'absorbance'
}

export function tryParseMultiSectionGrid(rows, sheetName, fileName) {
  if (!rows || rows.length < 3) return null

  // Scan the entire sheet for section headers
  // A section header: col[0] is a non-empty non-numeric string,
  //                   col[1..N] are consecutive integers 1, 2, ..., N (at least 3)
  const allSections = []
  let i = 0

  while (i < rows.length) {
    const row = rows[i] || []
    const c0 = row[0]

    // Check if this row is a section header
    let isSectionHeader = false
    let numCols = 0

    if (c0 != null && typeof c0 !== 'number') {
      const label = String(c0).trim()
      if (label && label.toLowerCase() !== 'sample') {
        let n = 0
        for (let c = 1; c <= 24; c++) {
          const v = row[c]
          if (typeof v === 'number' && Math.round(v) === n + 1) n++
          else break
        }
        if (n >= 3) {
          isSectionHeader = true
          numCols = n
        }
      }
    }

    if (isSectionHeader) {
      const sectionLabel = String(c0).trim()
      const wellData = {}
      let lastDataRow = i

      // Parse data rows immediately following the section header
      for (let j = i + 1; j < rows.length; j++) {
        const dataRow = rows[j] || []
        const rc0 = String(dataRow[0] ?? '').trim()
        if (!rc0) { lastDataRow = j; continue }  // blank row label — might be between rows
        if (!/^[A-P]$/.test(rc0)) break          // not a plate row letter → end of section

        for (let c = 1; c <= numCols; c++) {
          const v = dataRow[c]
          if (typeof v === 'number' && !isNaN(v)) {
            wellData[`${rc0}${c}`] = [v]
          }
        }
        lastDataRow = j
      }

      // Only include sections that produced numeric data
      if (Object.keys(wellData).length > 0) {
        const allVals  = Object.values(wellData).flat().filter(v => v != null)
        const readType = parseReadType(sectionLabel, allVals)
        const plateSize = inferPlateSize(wellData)

        allSections.push({
          format:       'gridsections',
          fileName,
          sheetName,
          sectionLabel,
          meta:         { fileName, instrument: null, experimentName: `${sheetName} — ${sectionLabel}` },
          wellIds:      {},
          wellNames:    {},
          readType,
          wavelengths:  parseWavelengths(sectionLabel),
          plateSize,
          isKinetic:    false,
          times:        null,
          temps:        null,
          wellData,
        })
      }

      i = lastDataRow + 1
    } else {
      i++
    }
  }

  // If multiple sections found, propagate well names from a text plate map
  // (a section where the wells contain strings instead of numbers)
  applySharedWellNames(rows, allSections)

  return allSections.length > 0 ? allSections : null
}

// If a grid of same dimensions exists earlier in the sheet with text values
// (sample names), apply those names to all matching-size sections
function applySharedWellNames(rows, sections) {
  if (sections.length === 0) return

  // Look for a grid of text matching any section's plate size
  for (const section of sections) {
    const positions = Object.keys(section.wellData)
    const maxRowOrd = Math.max(...positions.map(p => p.charCodeAt(0) - 64))
    const maxCol    = Math.max(...positions.map(p => parseInt(p.slice(1))))

    // Scan for a text grid of same shape
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || []
      const c0 = String(row[0] ?? '').trim()
      if (!/^[A-P]$/.test(c0)) continue

      // Check if next maxRowOrd rows form a text grid
      const textNames = {}
      let valid = true
      for (let r = 0; r < maxRowOrd; r++) {
        const dataRow = rows[i + r] || []
        const rc0 = String(dataRow[0] ?? '').trim()
        if (!/^[A-P]$/.test(rc0)) { valid = false; break }
        for (let c = 1; c <= maxCol; c++) {
          const v = dataRow[c]
          if (v == null || v === '') continue
          if (typeof v === 'string' && v.trim()) {
            textNames[`${rc0}${c}`] = v.trim()
          }
        }
      }

      if (valid && Object.keys(textNames).length > 0) {
        // Apply to all sections with matching dimensions where wellNames is empty
        for (const s of sections) {
          const sMaxRow = Math.max(...Object.keys(s.wellData).map(p => p.charCodeAt(0) - 64))
          const sMaxCol = Math.max(...Object.keys(s.wellData).map(p => parseInt(p.slice(1))))
          if (sMaxRow === maxRowOrd && sMaxCol === maxCol && Object.keys(s.wellNames).length === 0) {
            Object.assign(s.wellNames, textNames)
          }
        }
        break
      }
    }
  }
}
