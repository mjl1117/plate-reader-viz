/**
 * Parser for multi-section grid plate files (e.g., 20250605_Soil_GFP.xlsx).
 * Format:
 *   Section header row: [sectionLabel, 1, 2, ..., N, extra...]
 *   Data rows:          [rowLetter, val1, val2, ..., valN, extra...]
 *   Multiple sections may follow (separated by blank rows).
 *
 * Uses the first valid (numeric-data) section as the plate data.
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

export function tryParseMultiSectionGrid(rows, sheetName, fileName) {
  if (!rows || rows.length < 3) return null

  // Find first section header: col[0] is a non-empty non-numeric string,
  // col[1..N] are consecutive integers starting from 1 (at least 3)
  let sectionHeaderIdx = -1
  let numCols = 0

  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i] || []
    const c0 = row[0]
    if (c0 == null || typeof c0 === 'number') continue
    const label = String(c0).trim()
    if (!label || label.toLowerCase() === 'sample') continue

    // Count consecutive integers starting from 1 in col[1..]
    let n = 0
    for (let c = 1; c <= 24; c++) {
      const v = row[c]
      if (typeof v === 'number' && Math.round(v) === n + 1) n++
      else break
    }
    if (n >= 3) {
      sectionHeaderIdx = i
      numCols = n
      break
    }
  }

  if (sectionHeaderIdx === -1) return null

  // Parse the data rows following the section header
  // Only accept rows where col[0] is a single uppercase plate-row letter (A-P)
  const wellData = {}
  for (let i = sectionHeaderIdx + 1; i < rows.length; i++) {
    const row = rows[i] || []
    const c0 = String(row[0] ?? '').trim()
    if (!c0) continue
    if (!/^[A-P]$/.test(c0)) break  // not a plate row letter → end of section

    for (let c = 1; c <= numCols; c++) {
      const v = row[c]
      if (typeof v === 'number' && !isNaN(v)) {
        wellData[`${c0}${c}`] = [v]
      }
    }
  }

  if (Object.keys(wellData).length === 0) return null

  const allVals  = Object.values(wellData).flat().filter(v => v != null)
  const maxVal   = allVals.length ? Math.max(...allVals) : 0
  const readType = maxVal > 1e5 ? 'luminescence' : maxVal > 5 ? 'fluorescence' : 'absorbance'
  const plateSize = inferPlateSize(wellData)

  return {
    format:    'gridsections',
    fileName,
    sheetName,
    meta:      { fileName, instrument: null, experimentName: sheetName },
    wellIds:   {},
    wellNames: {},
    readType,
    wavelengths: [],
    plateSize,
    isKinetic: false,
    times:     null,
    temps:     null,
    wellData,
  }
}
