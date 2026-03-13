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
  // SoftMax Pro files start with ##BLOCKS=
  return text.trimStart().startsWith('##BLOCKS=')
}

async function parseXlsx(file) {
  const buf = await readFileAsArrayBuffer(file)
  const wb  = XLSX.read(buf, { type: 'array' })

  // Build sheetMap: raw arrays (for Tecan, SoftMax, SimpleKinetic)
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

  // 2. BioTek — convert first sheet to CSV and check for BioTek markers
  const firstCsv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]])
  if (isBiotekText(firstCsv)) {
    return parseBiotek(firstCsv, file.name)
  }

  // 3. Tecan analysis sheets
  const tecan = parseTecan(sheetMap, file.name)
  if (!tecan.error) return tecan

  // 4. Simple kinetic (e.g. NarXL: starts with "Lum" then has Time header)
  for (const [name, rows] of Object.entries(sheetMap)) {
    const r = tryParseSimpleKinetic(rows, name, file.name)
    if (r) return r
  }

  // 5. Multi-section grid (e.g. Soil_GFP: label + col-numbers header, then A-H data rows)
  for (const [name, rows] of Object.entries(sheetMap)) {
    const r = tryParseMultiSectionGrid(rows, name, file.name)
    if (r) return r
  }

  // 6. Temperature-column grid (e.g. MG_Data: col[1]=Temperature, col[2..N]=column numbers)
  for (const [name, rows] of Object.entries(sheetMap)) {
    const r = tryParseTempGrid(rows, name, file.name)
    if (r) return r
  }

  // 7. Last resort: try BioTek anyway (catches edge cases)
  return parseBiotek(firstCsv, file.name)
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
    if (isSoftmaxText(text)) {
      // SoftMax Pro CSV export — convert to sheetMap-like structure and parse
      return parseSoftmaxCsv(text, file.name)
    }
    if (isBiotekText(text)) {
      return parseBiotek(text, file.name)
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
