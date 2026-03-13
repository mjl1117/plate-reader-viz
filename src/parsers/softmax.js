/**
 * Parser for Molecular Devices SoftMax Pro export format (XLSX).
 * Identifies via "##BLOCKS=" in the first cell.
 *
 * Supports multiple data blocks per sheet (one per wavelength/read type).
 * Returns an array of datasets when multiple blocks are found.
 *
 * Two sub-formats per block:
 *   Flat — column headers are well IDs (A1 … P24)
 *   Grid — column headers are integers (1 … 24); plate rows A-P per timepoint
 */

const WELL_RE    = /^[A-P]\d{1,2}$/
const PLATE_ROWS = 'ABCDEFGHIJKLMNOP'

export function parseSoftmax(sheetMap, fileName) {
  for (const [sheetName, rows] of Object.entries(sheetMap)) {
    const result = trySheet(rows, sheetName, fileName)
    if (result) return result  // already fully formed (single or array)
  }
  return { error: true, message: 'No parseable SoftMax Pro sheet found.', fileName }
}

function trySheet(rows, sheetName, fileName) {
  if (!rows || rows.length < 3) return null
  if (!String(rows[0]?.[0] ?? '').trim().startsWith('##BLOCKS=')) return null

  const allDatasets = []
  let scanPos = 1  // start after ##BLOCKS= row

  while (scanPos < rows.length) {
    // Skip blank rows
    while (scanPos < rows.length && !rows[scanPos]?.some(v => v != null && v !== '')) scanPos++
    if (scanPos >= rows.length) break

    // Skip ~End markers we might land on
    if (String(rows[scanPos]?.[0] ?? '').trim() === '~End') { scanPos++; continue }

    const parsed = tryParseOneBlock(rows, scanPos)
    if (!parsed) { scanPos++; continue }

    allDatasets.push(parsed.dataset)
    scanPos = parsed.nextRow
  }

  if (allDatasets.length === 0) return null

  const buildResult = (ds) => ({
    format:    'softmax',
    fileName,
    sheetName,
    meta: { fileName, instrument: 'Molecular Devices', experimentName: sheetName },
    wellIds:   {},
    wellNames: {},
    ...ds,
  })

  if (allDatasets.length === 1) return buildResult(allDatasets[0])
  return allDatasets.map(buildResult)
}

function tryParseOneBlock(rows, blockRowIdx) {
  const blockRow = rows[blockRowIdx] || []

  // A block header must have some non-null content
  if (!blockRow.some(v => v != null && v !== '')) return null
  if (String(blockRow[0] ?? '').trim() === '~End') return null

  const isKinetic   = blockRow.some(c => c === 'Kinetic')
  const readModeSrc = String(blockRow[5] ?? '').toLowerCase()
  const isLumBlock  = readModeSrc.includes('lum')

  // Wavelength: last number in 300–900 range in block header
  let wavelength = null
  for (let i = blockRow.length - 1; i >= 0; i--) {
    const v = blockRow[i]
    if (typeof v === 'number' && v >= 300 && v <= 900) { wavelength = v; break }
  }

  // Find the column-header row (col[1] contains 'Temperature')
  let colHeaderIdx = -1
  for (let i = blockRowIdx + 1; i < Math.min(blockRowIdx + 15, rows.length); i++) {
    const c1 = String(rows[i]?.[1] ?? '').toLowerCase()
    if (c1.includes('temp')) { colHeaderIdx = i; break }
  }
  if (colHeaderIdx === -1) return null

  // Find ~End marker for this block
  let endIdx = rows.length
  for (let i = colHeaderIdx + 1; i < rows.length; i++) {
    if (String(rows[i]?.[0] ?? '').trim() === '~End') { endIdx = i; break }
  }

  const colHeader   = rows[colHeaderIdx] || []
  const firstDataEl = colHeader[2]
  const isFlat      = WELL_RE.test(String(firstDataEl ?? ''))

  const wellData = {}
  const times    = []

  if (isFlat) {
    // ── Flat: each column = one well ────────────────────────────────────────
    const wellCols = []
    for (let c = 2; c < colHeader.length; c++) {
      const v = colHeader[c]
      if (v == null) continue
      if (WELL_RE.test(String(v))) wellCols.push({ idx: c, well: String(v) })
    }
    if (wellCols.length === 0) return null
    wellCols.forEach(({ well }) => { wellData[well] = [] })

    for (let i = colHeaderIdx + 1; i < endIdx; i++) {
      const row = rows[i] || []
      if (String(row[0] ?? '').trim() === '~End') break
      const temp = row[1]
      if (typeof temp !== 'number') continue
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
      if (!isKinetic) break
    }

  } else {
    // ── Grid: column headers are plate-column integers (1 … 24) ────────────
    const colNums = []
    for (let c = 2; c < colHeader.length; c++) {
      const v = colHeader[c]
      if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 24) {
        colNums.push({ idx: c, col: v })
      }
    }
    if (colNums.length === 0) return null

    let plateRow = -1

    for (let i = colHeaderIdx + 1; i < endIdx; i++) {
      const row = rows[i] || []
      if (String(row[0] ?? '').trim() === '~End') break

      const c0 = row[0]
      if (c0 !== null && c0 !== undefined) {
        let secs = null
        if (typeof c0 === 'number')                          secs = Math.round(c0 * 86400)
        else if (typeof c0 === 'string' && c0.includes(':')) secs = timeStrToSecs(c0)
        if (secs === null) continue
        times.push(secs)
        plateRow = 0
      } else {
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

  const allVals  = Object.values(wellData).flat().filter(v => v != null)
  const maxVal   = allVals.length ? Math.max(...allVals) : 0
  const readType = isLumBlock || (wavelength == null && maxVal > 1e6)
    ? 'luminescence'
    : maxVal < 5 ? 'absorbance'
    : 'fluorescence'

  const effectiveKinetic = isKinetic && times.length > 1
  const positions    = Object.keys(wellData)
  const hasRow9Plus  = positions.some(p => /^[I-P]/i.test(p))
  const hasCol13Plus = positions.some(p => parseInt(p.match(/\d+/)?.[0] || 0) > 12)
  const plateSize    = (hasRow9Plus || hasCol13Plus) ? 384 : 96

  return {
    nextRow: endIdx + 1,
    dataset: {
      readType,
      wavelengths:  wavelength ? [wavelength] : [],
      plateSize,
      isKinetic:    effectiveKinetic,
      times:        effectiveKinetic ? times : null,
      temps:        null,
      wellData,
    },
  }
}

function timeStrToSecs(s) {
  const parts = s.split(':').map(Number)
  if (parts.some(isNaN)) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60  + parts[1]
  return null
}
