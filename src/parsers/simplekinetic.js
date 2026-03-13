/**
 * Parser for simple column-oriented kinetic files.
 * Handles files where:
 *   - There is a header row with "Time" (or "time") in column 0
 *   - Column 1 is optionally temperature (T°, Temp, etc.)
 *   - Columns 2+ are sample/condition names
 *   - Data rows have numeric time values in column 0 and measurements in the rest
 *
 * Examples: NarXL_Sensing.xlsx (starts with "Lum" then has Time header)
 */

export function tryParseSimpleKinetic(rows, sheetName, fileName) {
  if (!rows || rows.length < 3) return null

  // Find a header row where col[0] is 'time' (case-insensitive) and col[2+] are strings
  let headerIdx = -1
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i] || []
    const c0  = String(row[0] ?? '').trim().toLowerCase()
    if (c0 === 'time' && row.length >= 3) {
      // Verify col[2+] look like sample names (not all null, not well positions)
      const names = row.slice(2).filter(v => v != null && typeof v === 'string' && v.trim())
      if (names.length > 0) { headerIdx = i; break }
    }
  }
  if (headerIdx === -1) return null

  const headerRow = rows[headerIdx] || []

  // Col 1 might be a temperature column — detect by checking if it looks like "T°", "Temp", etc.
  const col1Label  = String(headerRow[1] ?? '').toLowerCase()
  const isTempCol1 = col1Label.includes('t°') || col1Label.includes('temp')
  const dataColStart = isTempCol1 ? 2 : 1

  // Map column index → sample name
  const sampleCols = []   // { idx, name }
  for (let c = dataColStart; c < headerRow.length; c++) {
    const v = headerRow[c]
    if (v == null) continue
    const name = String(v).trim()
    if (name) sampleCols.push({ idx: c, name })
  }
  if (sampleCols.length === 0) return null

  // Parse data rows
  const wellData  = {}   // sampleId → [vals]
  const wellNames = {}   // sampleId → sample name
  const times     = []

  // Map unique sample names to IDs
  const nameToId = {}
  const idxToId  = {}
  let   sampleCounter = 1
  for (const { idx, name } of sampleCols) {
    if (!nameToId[name]) {
      nameToId[name] = `S${sampleCounter++}`
    }
    idxToId[idx] = nameToId[name]
    wellNames[nameToId[name]] = name
    if (!wellData[nameToId[name]]) wellData[nameToId[name]] = []
  }

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || []
    const c0  = row[0]
    if (c0 === null || c0 === undefined) continue

    // Time: numeric fraction of day or time-string
    let secs = null
    if (typeof c0 === 'number')                          secs = Math.round(c0 * 86400)
    else if (typeof c0 === 'string' && c0.includes(':')) secs = timeStrToSecs(c0)
    if (secs === null) continue

    times.push(secs)

    for (const { idx } of sampleCols) {
      const id = idxToId[idx]
      const v  = row[idx]
      wellData[id].push(typeof v === 'number' ? v : null)
    }
  }

  if (times.length === 0) return null

  const allVals  = Object.values(wellData).flat().filter(v => v != null)
  const maxVal   = allVals.length ? Math.max(...allVals) : 0
  const readType = maxVal > 500 ? 'fluorescence' : 'absorbance'

  return {
    format:    'simplekinetic',
    fileName,
    sheetName,
    meta: {
      fileName,
      instrument:     null,
      experimentName: sheetName,
    },
    wellIds:      {},
    wellNames,
    readType,
    wavelengths:  [],
    plateSize:    null,
    isKinetic:    times.length > 1,
    isSampleBased: true,
    times,
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
