import * as XLSX from 'xlsx'
import { parseBiotek }             from './biotek.js'
import { parseMatrix }             from './matrix.js'
import { parseTecan }              from './tecan.js'
import { parseSoftmax }            from './softmax.js'
import { tryParseSimpleKinetic }   from './simplekinetic.js'
import { tryParseMultiSectionGrid } from './gridsections.js'
import { tryParseTempGrid }        from './tempgrid.js'

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsText(file)
  })
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

function isBiotekText(text) {
  const head = text.slice(0, 2000)
  return head.includes('Software Version') || head.startsWith('Well IDs')
}

function isSoftmaxText(text) {
  return text.trimStart().startsWith('##BLOCKS=')
}

// Try all array-based parsers on a set of row arrays; return all results across all sheets
function tryArrayParsers(sheetMap, fileName) {
  const parsers = [tryParseSimpleKinetic, tryParseMultiSectionGrid, tryParseTempGrid]
  const all = []
  for (const [name, rows] of Object.entries(sheetMap)) {
    for (const tryParser of parsers) {
      const r = tryParser(rows, name, fileName)
      if (r) {
        all.push(...(Array.isArray(r) ? r : [r]))
        break  // one parser per sheet
      }
    }
  }
  return all
}

async function parseXlsx(file) {
  const buf = await readFileAsArrayBuffer(file)
  const wb  = XLSX.read(buf, { type: 'array' })

  // Build sheetMap: raw arrays (for all array-based parsers)
  const sheetMap = {}
  for (const name of wb.SheetNames) {
    sheetMap[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null })
  }

  // 1. SoftMax Pro — first cell of first sheet starts with ##BLOCKS=
  const firstCell = String(sheetMap[wb.SheetNames[0]]?.[0]?.[0] ?? '').trim()
  if (firstCell.startsWith('##BLOCKS=')) {
    const r = parseSoftmax(sheetMap, file.name)
    if (!r.error) return r
  }

  // 2. BioTek — convert each sheet to CSV and check for BioTek markers
  //    Try all sheets and collect all BioTek results
  const biotekResults = []
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name])
    if (isBiotekText(csv)) {
      const r = parseBiotek(csv, file.name)
      if (r && !r.error) {
        const arr = Array.isArray(r) ? r : [r]
        // Tag each result with the sheet name if multi-sheet
        if (wb.SheetNames.length > 1) {
          arr.forEach(d => { if (!d.sectionLabel) d.sectionLabel = name })
        }
        biotekResults.push(...arr)
      }
    }
  }
  if (biotekResults.length > 0) {
    return biotekResults.length === 1 ? biotekResults[0] : biotekResults
  }

  // 3. Tecan analysis sheets
  const tecan = parseTecan(sheetMap, file.name)
  if (!tecan.error) return tecan

  // 4–6. SimpleKinetic / MultiSectionGrid / TempGrid — try ALL sheets, collect all
  const arrayParsed = tryArrayParsers(sheetMap, file.name)
  if (arrayParsed.length > 0) {
    return arrayParsed.length === 1 ? arrayParsed[0] : arrayParsed
  }

  // 7. Last resort: BioTek fallback on first sheet
  const firstCsv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]])
  return parseBiotek(firstCsv, file.name)
}

// Convert text to row arrays (handles both tab and comma delimiters)
function textToRows(text) {
  const lines = text.split('\n').filter(l => l.trim()).slice(0, 10)
  let tabs = 0, commas = 0
  for (const l of lines) {
    tabs   += (l.match(/\t/g)  || []).length
    commas += (l.match(/,/g) || []).length
  }
  const sep = tabs > commas ? '\t' : ','
  return text.split(/\r?\n/).map(l => l.split(sep).map(v => {
    const s = v.trim()
    if (!s) return null
    const n = Number(s)
    return isNaN(n) ? s : n
  }))
}

export async function parseFile(file) {
  const name = file.name.toLowerCase()

  if (name.endsWith('.xpt')) {
    return {
      error: true,
      message: 'BioTek .xpt binary format detected.\nPlease re-export from Gen5 software as CSV or Excel.',
      fileName: file.name,
    }
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    try {
      return await parseXlsx(file)
    } catch (e) {
      return { error: true, message: `Failed to parse Excel file: ${e.message}`, fileName: file.name }
    }
  }

  if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv')) {
    const text = await readFileAsText(file)
    if (isSoftmaxText(text)) return parseSoftmaxCsv(text, file.name)
    if (isBiotekText(text))  return parseBiotek(text, file.name)

    // Also try array-based parsers for tab/csv text files (e.g. TempGrid .txt exports)
    const sheetName = file.name.replace(/\.[^.]+$/, '')
    const rows = textToRows(text)
    const arrayParsed = tryArrayParsers({ [sheetName]: rows }, file.name)
    if (arrayParsed.length > 0) {
      return arrayParsed.length === 1 ? arrayParsed[0] : arrayParsed
    }

    return parseMatrix(text, file.name)
  }

  return {
    error: true,
    message: 'Unsupported file format. Please upload a .csv, .txt, .xlsx, or .xls file.',
    fileName: file.name,
  }
}

// SoftMax Pro CSV: convert to row arrays the same way XLSX does, then reuse parseSoftmax
function parseSoftmaxCsv(text, fileName) {
  const lines = text.split(/\r?\n/)
  const rows  = lines.map(l => l.split('\t').map(v => {
    if (v === '' || v == null) return null
    const n = parseFloat(v)
    return isNaN(n) ? v : n
  }))
  const sheetName = fileName.replace(/\.[^.]+$/, '')
  return parseSoftmax({ [sheetName]: rows }, fileName)
}
