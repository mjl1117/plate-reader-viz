import * as XLSX from 'xlsx'
import { parseBiotek } from './biotek.js'
import { parseMatrix } from './matrix.js'
import { parseTecan } from './tecan.js'

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
  // BioTek Gen5 files always contain "Software Version" near the top
  // or start with "Well IDs" (comma-delimited export)
  const head = text.slice(0, 2000)
  return head.includes('Software Version') || head.startsWith('Well IDs')
}

async function parseXlsx(file) {
  const buf = await readFileAsArrayBuffer(file)
  const wb  = XLSX.read(buf, { type: 'array' })

  // Build sheetMap for Tecan: sheetName → array of arrays
  const sheetMap = {}
  for (const name of wb.SheetNames) {
    sheetMap[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null })
  }

  // Check first sheet as CSV for BioTek markers
  const firstCsv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]])
  if (isBiotekText(firstCsv)) {
    return parseBiotek(firstCsv, file.name)
  }

  // Try Tecan analysis format
  const tecan = parseTecan(sheetMap, file.name)
  if (!tecan.error) return tecan

  // Last resort: try BioTek anyway
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
