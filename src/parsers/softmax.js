/**
 * Parser for Molecular Devices SoftMax Pro export format (XLSX).
 * Identifies via "##BLOCKS=" in the first cell.
 *
 * Two sub-formats:
 *   Flat   — column header row has well IDs (A1, A2 … P24); one data row per plate row
 *   Grid   — column header row has integers (1, 2 … 24); each timepoint occupies
 *            one row per plate row (A = first row, B = second, etc.)
 */

const WELL_RE   = /^[A-P]\d{1,2}$/
const PLATE_ROWS = 'ABCDEFGHIJKLMNOP'

export function parseSoftmax(sheetMap, fileName) {
  for (const [sheetName, rows] of Object.entries(sheetMap)) {
    const result = trySheet(rows, sheetName, fileName)
    if (result) return { format: 'softmax', fileName, sheetName, ...result }
  }
  return { error: true, message: 'No parseable SoftMax Pro sheet found.', fileName }
}

function trySheet(rows, sheetName, fileName) {
  if (!rows || rows.length < 3) return null
  if (!String(rows[0]?.[0] ?? '').trim().startsWith('##BLOCKS=')) return null

  const blockRow  = rows[1] || []
  const isKinetic = blockRow.some(c => c === 'Kinetic')

  // Wavelength: last number in 300–900 range in block header
  let wavelength = null
  for (let i = blockRow.length - 1; i >= 0; i--) {
    const v = blockRow[i]
    if (typeof v === 'number' && v >= 300 && v <= 900) { wavelength = v; break }
  }

  // Read mode
  const readModeSrc = String(blockRow[5] ?? '').toLowerCase()
  const isLumBlock  = readModeSrc.includes('lum')

  // Find the column-header row — col[1] contains 'Temperature' (or similar)
  let colHeaderIdx = -1
  for (let i = 2; i < Math.min(rows.length, 15); i++) {
    const row = rows[i] || []
    const c1  = String(row[1] ?? '').toLowerCase()
    if (c1.includes('temp')) { colHeaderIdx = i; break }
  }
  if (colHeaderIdx === -1) return null

  const colHeader   = rows[colHeaderIdx] || []
  const firstDataEl = colHeader[2]

  // Flat format: column headers are well IDs (A1, A2 … P24)
  const isFlat = WELL_RE.test(String(firstDataEl ?? ''))

  const wellData = {}
  const times    = []

  if (isFlat) {
    // ── Flat: each column = one well ──────────────────────────────────────────
    const wellCols = []
    for (let c = 2; c < colHeader.length; c++) {
      const v = colHeader[c]
      if (v == null) continue
      if (WELL_RE.test(String(v))) wellCols.push({ idx: c, well: String(v) })
    }
    if (wellCols.length === 0) return null
    wellCols.forEach(({ well }) => { wellData[well] = [] })

    for (let i = colHeaderIdx + 1; i < rows.length; i++) {
      const row = rows[i] || []
      if (String(row[0] ?? '').trim() === '~End') break
      const temp = row[1]
      if (typeof temp !== 'number') continue   // only rows with a temperature
      // Collect time for kinetic flat
      if (isKinetic) {
        const t = row[0]
        const secs = typeof t === 'number' ? Math.round(t * 86400)
          : typeof t === 'string' && t.includes(':') ? timeStrToSecs(t)
          : null
        if (secs !== null) times.push(secs)
      }
      for (const { idx, well } of wellCols) {
        const v = row[idx]
        wellData[well].push(typeof v === 'number' ? v : null)
      }
      if (!isKinetic) break   // endpoint: only first row
    }

  } else {
    // ── Grid: column headers are plate-column integers (1 … 24) ──────────────
    const colNums = []
    for (let c = 2; c < colHeader.length; c++) {
      const v = colHeader[c]
      if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 24) {
        colNums.push({ idx: c, col: v })
      }
    }
    if (colNums.length === 0) return null

    let plateRow = -1   // index into PLATE_ROWS

    for (let i = colHeaderIdx + 1; i < rows.length; i++) {
      const row = rows[i] || []
      if (String(row[0] ?? '').trim() === '~End') break

      const c0 = row[0]

      if (c0 !== null && c0 !== undefined) {
        // New timepoint starts
        let secs = null
        if (typeof c0 === 'number')                         secs = Math.round(c0 * 86400)
        else if (typeof c0 === 'string' && c0.includes(':')) secs = timeStrToSecs(c0)
        if (secs === null) continue

        times.push(secs)
        plateRow = 0
      } else {
        // Continuation row (same timepoint, next plate row)
        // Only count if it has at least one numeric value
        const hasData = colNums.some(({ idx }) => typeof row[idx] === 'number')
        if (!hasData) continue
        plateRow++
      }

      if (plateRow < 0 || plateRow >= PLATE_ROWS.length) continue

      const rowLetter = PLATE_ROWS[plateRow]
      for (const { idx, col } of colNums) {
        const v = row[idx]
        if (typeof v !== 'number') continue
        const wid = `${rowLetter}${col}`
        if (!wellData[wid]) wellData[wid] = []
        wellData[wid].push(v)
      }
    }
  }

  // Remove all-null wells
  for (const [k, arr] of Object.entries(wellData)) {
    if (arr.every(v => v === null)) delete wellData[k]
  }
  if (Object.keys(wellData).length === 0) return null

  const allVals = Object.values(wellData).flat().filter(v => v != null)
  const maxVal  = allVals.length ? Math.max(...allVals) : 0
  const readType = isLumBlock || (wavelength == null && maxVal > 1e6)
    ? 'luminescence'
    : maxVal < 5 ? 'absorbance'
    : 'fluorescence'

  const effectiveKinetic = isKinetic && times.length > 1
  const positions = Object.keys(wellData)
  const hasRow9Plus  = positions.some(p => /^[I-P]/i.test(p))
  const hasCol13Plus = positions.some(p => parseInt(p.match(/\d+/)?.[0] || 0) > 12)
  const plateSize = (hasRow9Plus || hasCol13Plus) ? 384 : 96

  return {
    meta: {
      fileName,
      instrument: 'Molecular Devices',
      experimentName: sheetName,
    },
    wellIds:   {},
    wellNames: {},
    readType,
    wavelengths:  wavelength ? [wavelength] : [],
    plateSize,
    isKinetic:    effectiveKinetic,
    times:        effectiveKinetic ? times : null,
    temps:        null,
    wellData,
  }
}

function timeStrToSecs(s) {
  const parts = s.split(':').map(Number)
  if (parts.some(isNaN)) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60  + parts[1]
  return null
}
