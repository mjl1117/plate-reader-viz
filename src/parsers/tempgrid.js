/**
 * Parser for MG-style endpoint plate reader files (e.g., MG_Data_031326.xlsx).
 * Structure:
 *   Row 0: [null, 'Temperature(°C)', 1, 2, ..., 12, null, 1, ..., 12, ...]
 *   Row 1: [null, temp, val, val, ...,          null, val, val, ...]
 *   ...
 *
 * Col[1] is a temperature label; col[2..N] are consecutive column-number integers.
 * Multiple groups of columns may appear, separated by null/undefined cells.
 * ALL groups are returned as separate datasets.
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

  // Find the header row: col[0] or col[1] is a temperature label, followed by 1, 2, 3, ...
  // Format A: [null, 'Temperature(°C)', 1, 2, ..., 12, ...]   (col[2] = first number)
  // Format B: ['Temperature(°C)', 1, 2, ..., 12, ...]          (col[1] = first number)
  let headerIdx = -1
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const row = rows[i] || []
    const c0 = String(row[0] ?? '').trim().toLowerCase()
    const c1 = String(row[1] ?? '').trim().toLowerCase()
    const hasTemp = c0.includes('temp') || c0.includes('t°') ||
                    c1.includes('temp') || c1.includes('t°')
    const hasFirst = row[1] === 1 || row[1] === 1.0 || row[2] === 1 || row[2] === 1.0
    if (hasTemp && hasFirst) { headerIdx = i; break }
  }
  if (headerIdx === -1) return null

  const headerRow = rows[headerIdx]

  // Find ALL groups of consecutive integers separated by null/undefined.
  // Start at c=1 so we catch groups that begin right after the temperature label (Format B).
  const groups = []  // [{ start, end }]
  let gStart = -1

  for (let c = 1; c < headerRow.length; c++) {
    const v = headerRow[c]
    const isNull = v === null || v === undefined
    const isNum  = typeof v === 'number'

    if (gStart === -1) {
      if (isNum && Math.round(v) === 1) gStart = c
    } else {
      const expected = c - gStart + 1
      if (isNull) {
        groups.push({ start: gStart, end: c - 1 })
        gStart = -1
      } else if (!isNum || Math.round(v) !== expected) {
        groups.push({ start: gStart, end: c - 1 })
        gStart = isNum && Math.round(v) === 1 ? c : -1
      }
    }
  }
  if (gStart !== -1) groups.push({ start: gStart, end: headerRow.length - 1 })
  if (groups.length === 0) return null

  // Parse data rows (rows after header, skip rows that are all-null in all groups)
  const dataRows = rows.slice(headerIdx + 1).filter(r =>
    r && groups.some(g =>
      r.slice(g.start, g.end + 1).some(v => typeof v === 'number' && !isNaN(v))
    )
  )

  // Parse each group as a separate dataset
  const allDatasets = groups.map((group, gi) => {
    const wellData = {}

    dataRows.forEach((row, ri) => {
      if (ri >= PLATE_ROW_LETTERS.length) return
      const rowLetter = PLATE_ROW_LETTERS[ri]
      for (let c = group.start; c <= group.end; c++) {
        const colNum = c - group.start + 1
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
      format:     'tempgrid',
      fileName,
      sheetName,
      groupIndex: gi + 1,
      meta: {
        fileName,
        instrument:     null,
        experimentName: `${sheetName} — Group ${gi + 1}`,
      },
      wellIds:    {},
      wellNames:  {},
      readType,
      wavelengths: [],
      plateSize,
      isKinetic:  false,
      times:      null,
      temps:      null,
      wellData,
    }
  }).filter(Boolean)

  return allDatasets.length > 0 ? allDatasets : null
}
