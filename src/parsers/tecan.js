/**
 * Parser for Tecan plate reader analysis export format (XLSX).
 *
 * Targets pre-processed analysis sheets that have this structure:
 *   Row N:   ["Sample", time0, time1, ..., timeN]   (times in hours)
 *   Row N+1: [sampleName, val0, val1, ...]
 *   ...
 *
 * Some sheets have an extra header row before it:
 *   Row 0:   [dateSerial, "Time", "", ...]
 *   Row 1:   ["Sample", 0, 0.0104, ...]
 *
 * Also handles the Triplicates / FITC Triplicates sheets with same structure.
 */

// Priority order for which sheet to use
const PREFERRED_SHEETS = [
  'Kinetics Analysis',
  'Kinetics Analysis 2',
  'Kinetics Analysis 3',
  'FITC Average',
  'Averaged',
  'FITC Triplicates',
  'Triplicates',
  'Normalized',
  'FITC 1',
  'FITC 2',
  'FITC 3',
]

export function parseTecan(sheetMap, fileName) {
  const results = []
  const attempted = new Set()

  // Try all preferred sheets (collect all matches, not just first)
  for (const name of PREFERRED_SHEETS) {
    if (sheetMap[name] && !attempted.has(name)) {
      attempted.add(name)
      const r = tryParseSheet(sheetMap[name], name)
      if (r) results.push({ name, r })
    }
  }

  // Fallback: try remaining sheets
  if (results.length === 0) {
    for (const [name, rows] of Object.entries(sheetMap)) {
      if (!attempted.has(name)) {
        const r = tryParseSheet(rows, name)
        if (r) { results.push({ name, r }); break }
      }
    }
  }

  if (results.length === 0) {
    return {
      error: true,
      message: 'Could not find a parseable analysis sheet.\nLooking for a sheet with "Sample" header and numeric time columns.',
      fileName,
    }
  }

  if (results.length === 1) {
    return {
      format: 'tecan',
      fileName,
      sheetName: results[0].name,
      availableSheets: Object.keys(sheetMap),
      ...results[0].r,
    }
  }

  // Combine multiple sheets (e.g. FITC 1 + FITC 2 + FITC 3)
  const primary = results[0].r
  const combinedWellData  = { ...primary.wellData }
  const combinedWellNames = { ...primary.wellNames }
  let idCounter = Object.keys(primary.wellData).length + 1

  for (let si = 1; si < results.length; si++) {
    const { r } = results[si]
    for (const [id, vals] of Object.entries(r.wellData)) {
      const newId = `S${idCounter++}`
      combinedWellData[newId]  = vals
      combinedWellNames[newId] = r.wellNames[id] || id
    }
  }

  const allVals  = Object.values(combinedWellData).flat().filter(v => v != null)
  const maxVal   = allVals.length ? Math.max(...allVals) : 0
  const readType = maxVal > 500 ? 'fluorescence' : 'absorbance'
  const times    = primary.times

  return {
    format: 'tecan',
    fileName,
    sheetName: results.map(r => r.name).join(' + '),
    availableSheets: Object.keys(sheetMap),
    meta: {
      fileName,
      instrument: 'Tecan',
      experimentName: results.map(r => r.name).join(' + '),
    },
    wellIds:      {},
    wellNames:    combinedWellNames,
    readType,
    wavelengths:  [],
    plateSize:    null,
    isKinetic:    times && times.length > 1,
    isSampleBased: true,
    times,
    temps:        null,
    wellData:     combinedWellData,
  }
}

function tryParseSheet(rows, sheetName) {
  if (!rows || rows.length < 2) return null

  // Find the row where col[0] === "Sample" (case-insensitive) and col[1] is numeric
  let headerIdx = -1
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const row = rows[i]
    if (!row || row.length < 2) continue
    const first = String(row[0] ?? '').trim().toLowerCase()
    const second = row[1]
    if (first === 'sample' && (typeof second === 'number' || !isNaN(parseFloat(second)))) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) return null

  const headerRow = rows[headerIdx]

  // Extract time values (hours → seconds)
  const timeCols = []  // { colIdx, timeSeconds }
  for (let c = 1; c < headerRow.length; c++) {
    const v = headerRow[c]
    if (v === '' || v == null) continue
    const n = typeof v === 'number' ? v : parseFloat(v)
    if (!isNaN(n)) timeCols.push({ colIdx: c, timeSeconds: Math.round(n * 3600) })
  }
  if (timeCols.length === 0) return null

  const times = timeCols.map(t => t.timeSeconds)

  // Parse sample data rows
  const wellData  = {}  // pseudoId → [val per timepoint]
  const wellNames = {}  // pseudoId → sample name
  let   sampleIdx = 0

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row[0] == null || row[0] === '') continue
    const name = String(row[0]).trim()
    if (!name) continue

    const vals = timeCols.map(({ colIdx }) => {
      const v = row[colIdx]
      if (v === '' || v == null) return null
      const n = typeof v === 'number' ? v : parseFloat(v)
      return isNaN(n) ? null : n
    })

    const id = `S${sampleIdx + 1}`
    wellData[id]  = vals
    wellNames[id] = name
    sampleIdx++
  }

  if (sampleIdx === 0) return null

  const allVals = Object.values(wellData).flat().filter(v => v != null)
  const maxVal  = allVals.length ? Math.max(...allVals) : 0
  const readType = maxVal > 500 ? 'fluorescence' : 'absorbance'

  return {
    meta: {
      fileName,
      instrument: 'Tecan',
      experimentName: sheetName,
    },
    wellIds:      {},
    wellNames,
    readType,
    wavelengths:  [],
    plateSize:    null,
    isKinetic:    times.length > 1,
    isSampleBased: true,   // No plate grid positions — samples are rows
    times,
    temps: null,
    wellData,
  }
}
