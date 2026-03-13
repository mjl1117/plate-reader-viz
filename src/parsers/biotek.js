/**
 * Parser for BioTek Gen5 export files.
 * Handles both tab-delimited (.csv, .txt) and comma-delimited (.csv) exports,
 * as well as XLSX files (passed in as pre-converted CSV text via SheetJS).
 *
 * Supported read types: kinetic fluorescence/absorbance/luminescence, endpoint.
 * Supported plate formats: 96-well, 384-well.
 */

const WELL_PATTERN = /^[A-P]\d{1,2}$/

function detectDelimiter(text) {
  const lines = text.split('\n').filter(l => l.trim()).slice(0, 10)
  let tabs = 0, commas = 0
  for (const l of lines) {
    tabs  += (l.match(/\t/g)  || []).length
    commas += (l.match(/,/g) || []).length
  }
  return tabs > commas ? '\t' : ','
}

function parseTimeToSeconds(s) {
  if (!s) return 0
  const parts = s.trim().split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return 0
}

function inferPlateSize(wellData) {
  const positions = Object.keys(wellData)
  const hasRow9Plus = positions.some(p => /^[I-P]/i.test(p))
  const hasCol13Plus = positions.some(p => parseInt(p.match(/\d+/)?.[0] || 0) > 12)
  return (hasRow9Plus || hasCol13Plus) ? 384 : 96
}

function inferReadType(wavelengths, meta, wellData) {
  // Check luminescence
  if (wavelengths.some(w => /^lum/i.test(w))) return 'luminescence'
  if ((meta.readTypeRaw || '').toLowerCase().includes('lum')) return 'luminescence'

  // Heuristic: if all values are small decimals → absorbance
  const allValues = Object.values(wellData).flat().filter(v => v != null && !isNaN(v))
  if (allValues.length > 0) {
    const max = Math.max(...allValues)
    if (max < 5) return 'absorbance'
  }

  // Check wavelength range: excitation 300-500nm often fluorescence
  if (wavelengths.some(w => !isNaN(Number(w)) && Number(w) >= 300 && Number(w) <= 600)) {
    const allValues2 = Object.values(wellData).flat().filter(v => v != null && !isNaN(v))
    const max2 = Math.max(...allValues2)
    return max2 > 10 ? 'fluorescence' : 'absorbance'
  }

  return 'fluorescence'
}

export function parseBiotek(text, fileName) {
  const delim = detectDelimiter(text)
  const rawLines = text.split(/\r?\n/)
  const split = rawLines.map(l => l.split(delim).map(c => c.trim()))

  // ── Extract metadata ───────────────────────────────────────────────────────
  const meta = { fileName, readTypeRaw: '' }
  const kvClean = (s) => s.replace(/:$/, '').trim()

  for (let i = 0; i < Math.min(split.length, 80); i++) {
    const k = kvClean(split[i][0] || '')
    const v = (split[i][1] || '').trim()
    if (!k || !v) continue

    if (k === 'Software Version')                    meta.softwareVersion = v
    else if (k === 'Date')                           meta.date = v
    else if (k === 'Plate Number')                   meta.plateNumber = v
    else if (k.match(/Reader Type/i))                meta.instrument = v
    else if (k.match(/Reader Serial/i))              meta.serial = v
    else if (k.match(/Plate Type/i))                 meta.plateType = v
    else if (k.match(/Read/) && v.match(/Fluoresc|Absorb|Lumin|Kinetic/i)) {
      meta.readTypeRaw += ' ' + v
    }
    else if (k.match(/Wavelengths/i))                meta.wavelengthsMeta = v
    else if (k.match(/Start Kinetic/i))              meta.isKineticFromMeta = true
    // Time of day (metadata) looks like "4:16:12 PM" — has AM/PM
    else if (k === 'Time' && v.match(/AM|PM/i))     meta.timeOfDay = v
    else if (k.match(/Experiment File Path/i)) {
      const parts = v.replace(/\\/g, '/').split('/')
      meta.experimentName = parts[parts.length - 1].replace(/\.[^.]+$/, '')
    }
  }

  // ── Find key section boundaries ────────────────────────────────────────────
  let wellIdsStart    = -1
  let layoutStart     = -1
  let calcResultsLine = -1

  for (let i = 0; i < rawLines.length; i++) {
    const t = rawLines[i].trim()
    if (t === 'Well IDs')          { wellIdsStart    = i; continue }
    if (t === 'Layout')            { layoutStart     = i; continue }
    if (t === 'Results' && calcResultsLine === -1) { calcResultsLine = i; continue }
  }

  // ── Parse Well IDs section (comma-delimited format) ────────────────────────
  const wellIds = {}   // sampleName → wellPosition  e.g. "SPL1" → "A9"
  const wellNames = {} // wellPosition → sampleName  e.g. "A9" → "SPL1"

  if (wellIdsStart > -1) {
    let i = wellIdsStart + 1
    // Skip optional header row "Well ID,Name"
    if ((split[i]?.[0] || '').toLowerCase().includes('well id')) i++
    while (i < rawLines.length) {
      const line = rawLines[i].trim()
      if (!line) { i++; continue }
      if (line === 'Layout' || line === 'Results') break
      const parts = split[i]
      const name = parts[0]?.trim()
      const pos  = parts[1]?.trim()
      if (name && pos && WELL_PATTERN.test(pos)) {
        wellIds[name] = pos
        wellNames[pos] = name
      }
      i++
    }
  }

  // ── Parse Layout grid (tab-delimited format) ───────────────────────────────
  if (layoutStart > -1) {
    let i = layoutStart + 1
    // First row should be the column numbers: [empty, 1, 2, ..., 12]
    let colNumbers = []
    if (split[i] && split[i][0] === '' && split[i].some(c => /^\d+$/.test(c))) {
      colNumbers = split[i]
      i++
    }
    while (i < rawLines.length) {
      const row = split[i]
      const rowLetter = row[0]
      if (!/^[A-P]$/.test(rowLetter)) break
      for (let c = 1; c < row.length; c++) {
        const cell = row[c]
        if (!cell || cell === 'Well ID') continue
        // Determine column number from header or from index
        const colNum = parseInt(colNumbers[c] || c)
        if (!colNum) continue
        const pos = `${rowLetter}${colNum}`
        if (!wellNames[pos]) wellNames[pos] = cell
        if (!wellIds[cell])  wellIds[cell]  = pos
      }
      i++
    }
  }

  // ── Find the data header (line starting with "Time" that has well columns) ──
  let dataHeaderIdx   = -1
  let wavelengthsLine = -1

  for (let i = 0; i < rawLines.length; i++) {
    const cols = split[i]
    if (cols[0]?.toLowerCase() === 'time' && cols.some(c => WELL_PATTERN.test(c))) {
      dataHeaderIdx = i
      // Walk backward to find the wavelength line (last non-blank before data header)
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        const candidate = rawLines[j].trim()
        if (!candidate) continue
        // Wavelength line: contains only digits, commas, spaces, or "Lum"
        if (/^[\d,\s]+$/.test(candidate) || /^lum$/i.test(candidate)) {
          wavelengthsLine = j
        }
        break // stop at first non-blank line before data header
      }
      break
    }
  }

  // ── Also handle endpoint format: no "Time" column, just well values ────────
  // Look for a line that's purely well positions (A1, A2, ...) — endpoint header
  let endpointHeaderIdx = -1
  if (dataHeaderIdx === -1) {
    for (let i = 0; i < rawLines.length; i++) {
      const cols = split[i].filter(c => c)
      if (cols.length >= 4 && cols.every(c => WELL_PATTERN.test(c))) {
        endpointHeaderIdx = i
        // Wavelength line search
        for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
          const candidate = rawLines[j].trim()
          if (!candidate) continue
          if (/^[\d,\s]+$/.test(candidate) || /^lum$/i.test(candidate)) {
            wavelengthsLine = j
          }
          break
        }
        break
      }
    }
  }

  // ── Parse wavelengths ──────────────────────────────────────────────────────
  let wavelengths = []
  if (wavelengthsLine > -1) {
    const waveStr = rawLines[wavelengthsLine].trim()
    wavelengths = waveStr.split(/[,\s]+/).map(w => w.trim()).filter(Boolean)
  }

  // ── Parse kinetic data ─────────────────────────────────────────────────────
  const wellData  = {}
  const times     = []
  const temps     = []
  let   isKinetic = false

  if (dataHeaderIdx > -1) {
    isKinetic = true
    const headers = split[dataHeaderIdx]

    // Map column index → well position
    const wellCols = headers
      .map((h, i) => ({ h, i }))
      .filter(({ h }) => WELL_PATTERN.test(h))

    wellCols.forEach(({ h }) => { wellData[h] = [] })

    // Data rows end at blank line, "Results", or "Calculated Results"
    const stopAt = calcResultsLine > -1 ? calcResultsLine : rawLines.length
    for (let i = dataHeaderIdx + 1; i < stopAt; i++) {
      const line = rawLines[i].trim()
      if (!line) continue
      const cols = split[i]
      const timeStr = cols[0]
      if (!timeStr.includes(':')) continue // not a time row
      times.push(parseTimeToSeconds(timeStr))
      temps.push(parseFloat(cols[1]) || null)
      for (const { h, i: ci } of wellCols) {
        const v = parseFloat(cols[ci])
        wellData[h].push(isNaN(v) ? null : v)
      }
    }
  }

  // ── Parse endpoint data ────────────────────────────────────────────────────
  if (endpointHeaderIdx > -1 && !isKinetic) {
    const headers = split[endpointHeaderIdx]
    const wellCols = headers.map((h, i) => ({ h, i })).filter(({ h }) => WELL_PATTERN.test(h))
    wellCols.forEach(({ h }) => { wellData[h] = [] })
    // Next non-blank row is the values
    for (let i = endpointHeaderIdx + 1; i < rawLines.length; i++) {
      const line = rawLines[i].trim()
      if (!line) continue
      const cols = split[i]
      for (const { h, i: ci } of wellCols) {
        const v = parseFloat(cols[ci])
        wellData[h].push(isNaN(v) ? null : v)
      }
      break // only one row of values for endpoint
    }
  }

  // ── Fallback: try to extract from the Results section (BioTek calc results) ─
  // The Results section has: "Well ID" row, "Well" row, then metric rows.
  // The "Well" row gives us well positions, subsequent rows give values.
  if (Object.keys(wellData).length === 0 && calcResultsLine > -1) {
    let i = calcResultsLine + 1
    while (i < rawLines.length && !rawLines[i].trim()) i++
    // Find the "Well" row
    let wellRow = -1
    for (let j = i; j < Math.min(i + 5, rawLines.length); j++) {
      if (split[j][0]?.toLowerCase() === 'well') { wellRow = j; break }
    }
    if (wellRow > -1) {
      const wellPositions = split[wellRow].slice(1).filter(w => WELL_PATTERN.test(w))
      wellPositions.forEach(w => { wellData[w] = [null] })
      // Next metric row (e.g., "Max V [385]") gives numeric values
      for (let j = wellRow + 1; j < Math.min(wellRow + 3, rawLines.length); j++) {
        const row = split[j]
        if (!row[0] || row[0].startsWith('R-') || row[0].startsWith('t ') || row[0].startsWith('Lag')) continue
        const vals = row.slice(1)
        wellPositions.forEach((w, idx) => {
          const v = parseFloat(vals[idx])
          if (!isNaN(v)) wellData[w] = [v]
        })
        if (wellPositions.some(w => wellData[w][0] !== null)) break
      }
    }
  }

  const plateSize = inferPlateSize(wellData)
  const readType  = inferReadType(wavelengths, meta, wellData)

  return {
    format: 'biotek',
    fileName,
    meta,
    wellIds,
    wellNames,
    readType,
    wavelengths,
    plateSize,
    isKinetic,
    times:    isKinetic ? times : null,
    temps:    isKinetic ? temps : null,
    wellData,
  }
}
