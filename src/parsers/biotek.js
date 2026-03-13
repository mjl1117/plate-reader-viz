/**
 * Parser for BioTek Gen5 export files.
 * Handles both tab-delimited (.csv, .txt) and comma-delimited (.csv) exports,
 * as well as XLSX files (passed in as pre-converted CSV text via SheetJS).
 *
 * Supported read types: kinetic fluorescence/absorbance/luminescence, endpoint.
 * Supported plate formats: 6/24/96/384-well.
 * Multi-wavelength: returns an array of datasets when multiple blocks are found.
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

function inferReadType(wavelengths, meta, wellData) {
  if (wavelengths.some(w => /^lum/i.test(w))) return 'luminescence'
  if ((meta.readTypeRaw || '').toLowerCase().includes('lum')) return 'luminescence'

  const allValues = Object.values(wellData).flat().filter(v => v != null && !isNaN(v))
  if (allValues.length > 0) {
    const max = Math.max(...allValues)
    if (max < 5) return 'absorbance'
  }

  if (wavelengths.some(w => !isNaN(Number(w)) && Number(w) >= 300 && Number(w) <= 600)) {
    const max2 = Math.max(...Object.values(wellData).flat().filter(v => v != null && !isNaN(v)))
    return max2 > 10 ? 'fluorescence' : 'absorbance'
  }

  return 'fluorescence'
}

// Returns the wavelength string on the last non-blank line before `idx`
// if it looks like a wavelength line (digits/commas or "Lum"), else null.
function findPrecedingWavelength(rawLines, idx) {
  for (let j = idx - 1; j >= Math.max(0, idx - 5); j--) {
    const candidate = rawLines[j].trim()
    if (!candidate) continue
    if (/^[\d,\s]+$/.test(candidate) || /^lum$/i.test(candidate)) return candidate
    break
  }
  return null
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
    else if (k === 'Time' && v.match(/AM|PM/i))      meta.timeOfDay = v
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
    const t0 = split[i]?.[0] || ''
    if (t0 === 'Well IDs')                          { wellIdsStart    = i; continue }
    if (t0 === 'Layout')                            { layoutStart     = i; continue }
    if (t0 === 'Results' && calcResultsLine === -1) { calcResultsLine = i; continue }
  }

  // ── Parse Well IDs section ─────────────────────────────────────────────────
  const wellIds   = {}
  const wellNames = {}

  if (wellIdsStart > -1) {
    let i = wellIdsStart + 1
    if ((split[i]?.[0] || '').toLowerCase().includes('well id')) i++
    while (i < rawLines.length) {
      const line = rawLines[i].trim()
      const s0   = split[i]?.[0] || ''
      if (!line) { i++; continue }
      if (s0 === 'Layout' || s0 === 'Results') break
      const parts = split[i]
      const name = parts[0]?.trim()
      const pos  = parts[1]?.trim()
      if (name && pos && WELL_PATTERN.test(pos)) {
        wellIds[name]  = pos
        wellNames[pos] = name
      }
      i++
    }
  }

  // ── Parse Layout grid ──────────────────────────────────────────────────────
  if (layoutStart > -1) {
    let i = layoutStart + 1
    let colNumbers = []
    if (split[i] && split[i].some(c => /^\d+$/.test(c))) {
      colNumbers = split[i]
      i++
    }
    while (i < rawLines.length) {
      const row = split[i]
      const rowLetter = /^[A-P]$/.test(row[0]) ? row[0]
                      : /^[A-P]$/.test(row[1]) ? row[1]
                      : null
      if (!rowLetter) break
      const dataStart = /^[A-P]$/.test(row[0]) ? 1 : 2
      for (let c = dataStart; c < row.length; c++) {
        const cell = row[c]
        if (!cell || cell === 'Well ID') continue
        const colNum = parseInt(colNumbers[c] || (c - dataStart + 1))
        if (!colNum) continue
        const pos = `${rowLetter}${colNum}`
        if (!wellNames[pos]) wellNames[pos] = cell
        if (!wellIds[cell])  wellIds[cell]  = pos
      }
      i++
    }
  }

  // ── Find ALL kinetic data headers (each wavelength block has "Time" + wells) ─
  const allKineticHeaders = []
  for (let i = 0; i < rawLines.length; i++) {
    const cols = split[i]
    if (cols[0]?.toLowerCase() === 'time' && cols.some(c => WELL_PATTERN.test(c))) {
      const waveStr = findPrecedingWavelength(rawLines, i)
      allKineticHeaders.push({ idx: i, waveStr })
    }
  }

  // ── If no kinetic, look for endpoint well-position headers ─────────────────
  const allEndpointHeaders = []
  if (allKineticHeaders.length === 0) {
    for (let i = 0; i < rawLines.length; i++) {
      const cols = split[i].filter(c => c)
      if (cols.length >= 4 && cols.every(c => WELL_PATTERN.test(c))) {
        const waveStr = findPrecedingWavelength(rawLines, i)
        allEndpointHeaders.push({ idx: i, waveStr })
      }
    }
  }

  const isKinetic     = allKineticHeaders.length > 0
  const headerList    = isKinetic ? allKineticHeaders : allEndpointHeaders
  const outerStopLine = calcResultsLine > -1 ? calcResultsLine : rawLines.length

  // ── Parse each data block ──────────────────────────────────────────────────
  const blockDatasets = []

  for (let bi = 0; bi < headerList.length; bi++) {
    const { idx: headerIdx, waveStr } = headerList[bi]
    const nextBlockIdx = headerList[bi + 1]?.idx ?? outerStopLine

    const blockWavelengths = waveStr
      ? waveStr.split(/[,\s]+/).map(w => w.trim()).filter(Boolean)
      : []

    const hdrCols  = split[headerIdx]
    const wellCols = hdrCols.map((h, i) => ({ h, i })).filter(({ h }) => WELL_PATTERN.test(h))
    if (wellCols.length === 0) continue

    const bWellData = {}
    const bTimes    = []
    const bTemps    = []
    wellCols.forEach(({ h }) => { bWellData[h] = [] })

    if (isKinetic) {
      for (let i = headerIdx + 1; i < nextBlockIdx; i++) {
        const line = rawLines[i].trim()
        if (!line) continue
        const cols    = split[i]
        const timeStr = cols[0]
        if (!timeStr || !timeStr.includes(':')) continue
        bTimes.push(parseTimeToSeconds(timeStr))
        bTemps.push(parseFloat(cols[1]) || null)
        for (const { h, i: ci } of wellCols) {
          const v = parseFloat(cols[ci])
          bWellData[h].push(isNaN(v) ? null : v)
        }
      }
    } else {
      for (let i = headerIdx + 1; i < nextBlockIdx; i++) {
        const line = rawLines[i].trim()
        if (!line) continue
        const cols = split[i]
        for (const { h, i: ci } of wellCols) {
          const v = parseFloat(cols[ci])
          bWellData[h].push(isNaN(v) ? null : v)
        }
        break
      }
    }

    const hasData = Object.values(bWellData).some(arr => arr.some(v => v != null && !isNaN(v)))
    if (!hasData) continue

    blockDatasets.push({
      wellData:    bWellData,
      wavelengths: blockWavelengths,
      times:       isKinetic ? bTimes : null,
      temps:       isKinetic ? bTemps : null,
      isKinetic:   isKinetic && bTimes.length > 0,
    })
  }

  // ── Fallback A: Synergy H1 XLSX Results grid ──────────────────────────────
  const fallbackWellData = {}
  if (blockDatasets.length === 0 && calcResultsLine > -1) {
    let i = calcResultsLine + 1
    while (i < rawLines.length && (!rawLines[i].trim() || (split[i]?.[0] ?? '').toLowerCase().startsWith('actual'))) i++
    if (split[i] && split[i][0] === '' && split[i][1] === '' && /^\d+$/.test(split[i][2] || '')) {
      const colNums = split[i]
      i++
      while (i < rawLines.length) {
        const row = split[i]
        const rowLetter = /^[A-P]$/.test(row[1]) ? row[1] : null
        if (!rowLetter) break
        for (let c = 2; c < row.length; c++) {
          const cell = row[c]
          if (!cell || cell === 'Well ID') continue
          const colNum = parseInt(colNums[c])
          if (!colNum) continue
          const v = parseFloat(cell)
          if (isNaN(v)) continue
          fallbackWellData[`${rowLetter}${colNum}`] = [v]
        }
        i++
      }
    }
  }

  // ── Fallback B: BioTek calculated results section ─────────────────────────
  if (Object.keys(fallbackWellData).length === 0 && calcResultsLine > -1) {
    let i = calcResultsLine + 1
    while (i < rawLines.length && !rawLines[i].trim()) i++
    let wellRow = -1
    for (let j = i; j < Math.min(i + 5, rawLines.length); j++) {
      if (split[j][0]?.toLowerCase() === 'well') { wellRow = j; break }
    }
    if (wellRow > -1) {
      const wellPositions = split[wellRow].slice(1).filter(w => WELL_PATTERN.test(w))
      wellPositions.forEach(w => { fallbackWellData[w] = [null] })
      for (let j = wellRow + 1; j < Math.min(wellRow + 3, rawLines.length); j++) {
        const row = split[j]
        if (!row[0] || row[0].startsWith('R-') || row[0].startsWith('t ') || row[0].startsWith('Lag')) continue
        const vals = row.slice(1)
        wellPositions.forEach((w, idx) => {
          const v = parseFloat(vals[idx])
          if (!isNaN(v)) fallbackWellData[w] = [v]
        })
        if (wellPositions.some(w => fallbackWellData[w][0] !== null)) break
      }
    }
  }

  // ── Build output ───────────────────────────────────────────────────────────
  const makeResult = (block) => ({
    format:     'biotek',
    fileName,
    meta,
    wellIds,
    wellNames,
    readType:   inferReadType(block.wavelengths, meta, block.wellData),
    wavelengths: block.wavelengths,
    plateSize:  inferPlateSize(block.wellData),
    isKinetic:  block.isKinetic,
    times:      block.isKinetic ? block.times : null,
    temps:      block.isKinetic ? block.temps : null,
    wellData:   block.wellData,
  })

  if (blockDatasets.length === 1) return makeResult(blockDatasets[0])
  if (blockDatasets.length > 1)  return blockDatasets.map(makeResult)

  // Single fallback result
  const fbWavelengths = []
  const plateSize = inferPlateSize(fallbackWellData)
  const readType  = inferReadType(fbWavelengths, meta, fallbackWellData)
  return {
    format: 'biotek',
    fileName,
    meta,
    wellIds,
    wellNames,
    readType,
    wavelengths: fbWavelengths,
    plateSize,
    isKinetic:  false,
    times:      null,
    temps:      null,
    wellData:   fallbackWellData,
  }
}
