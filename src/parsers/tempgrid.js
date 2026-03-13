/**
 * Parser for MG-style endpoint plate reader files (e.g., MG_Data_031326.xlsx).
 * Structure:
 *   Row 0: [null, 'Temperature(°C)', 1, 2, ..., 12, null, 1, ..., 12, ...]
 *   Row 1: [null, temp, val, val, ...,          null, val, val, ...]
 *   ...
 *
 * Col[1] is a temperature label; col[2..N] are consecutive column-number integers.
 * Multiple groups of columns may appear, separated by null cells.
 * Uses the first group as the primary plate data; each data row → plate row A, B, C, ...
 */

const PLATE_ROW_LETTERS = 'ABCDEFGHIJKLMNOP'

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

export function tryParseTempGrid(rows, sheetName, fileName) {
  if (!rows || rows.length < 2) return null

  // Find the header row: col[1] is a temperature label, col[2] = 1 (first column number)
  let headerIdx = -1
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const row = rows[i] || []
    const c1 = String(row[1] ?? '').trim().toLowerCase()
    if ((c1.includes('temp') || c1.includes('t°')) &&
        (row[2] === 1 || row[2] === 1.0)) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) return null

  const headerRow = rows[headerIdx]

  // Find first group of consecutive integers starting from 1 in col[2..]
  let groupStart = -1, groupEnd = -1
  for (let c = 2; c < headerRow.length; c++) {
    const v = headerRow[c]
    if (groupStart === -1) {
      if (typeof v === 'number' && Math.round(v) === 1) groupStart = c
    } else {
      const expected = c - groupStart + 1
      if (typeof v !== 'number' || Math.round(v) !== expected) {
        groupEnd = c - 1
        break
      }
    }
  }
  if (groupStart === -1) return null
  if (groupEnd === -1) groupEnd = headerRow.length - 1

  const numCols = groupEnd - groupStart + 1

  // Parse data rows: skip any all-null rows; each valid row → next plate row letter
  const wellData = {}
  const dataRows = rows.slice(headerIdx + 1).filter(r =>
    r && r.some((v, ci) => ci >= groupStart && ci <= groupEnd && typeof v === 'number' && !isNaN(v))
  )

  dataRows.forEach((row, ri) => {
    if (ri >= PLATE_ROW_LETTERS.length) return
    const rowLetter = PLATE_ROW_LETTERS[ri]
    for (let c = groupStart; c <= groupEnd; c++) {
      const colNum = c - groupStart + 1
      const v = row[c]
      if (typeof v === 'number' && !isNaN(v)) {
        wellData[`${rowLetter}${colNum}`] = [v]
      }
    }
  })

  if (Object.keys(wellData).length === 0) return null

  const allVals  = Object.values(wellData).flat().filter(v => v != null)
  const maxVal   = allVals.length ? Math.max(...allVals) : 0
  const readType = maxVal > 1e5 ? 'luminescence' : maxVal > 5 ? 'fluorescence' : 'absorbance'
  const plateSize = inferPlateSize(wellData)

  return {
    format:    'tempgrid',
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
