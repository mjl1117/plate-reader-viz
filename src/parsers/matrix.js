/**
 * Parser for simple matrix-style plate reader CSV files.
 * Example: plate_reader_data_2_07_16.csv
 * Format: first row = column indices, first column = row label (concentration/sample),
 *         data = raw fluorescence or normalized values.
 */

export function parseMatrix(text, fileName) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  const rows = lines.map(l => l.split(',').map(c => c.trim()))

  // Detect sections separated by blank rows
  const allLines = text.split(/\r?\n/)
  const sections = []
  let current = []
  for (const line of allLines) {
    if (line.trim()) {
      current.push(line.split(',').map(c => c.trim()))
    } else if (current.length > 0) {
      sections.push(current)
      current = []
    }
  }
  if (current.length > 0) sections.push(current)

  // Use the first section as the primary data
  const primary = sections[0] || rows
  if (!primary || primary.length < 2) {
    return { format: 'matrix', error: 'Insufficient data', fileName }
  }

  const colHeaders = primary[0].slice(1) // drop first (row label) cell
  const dataRows   = primary.slice(1)

  const rowLabels = dataRows.map(r => r[0])
  const matrix    = dataRows.map(r => r.slice(1).map(v => {
    const n = parseFloat(v)
    return isNaN(n) ? null : n
  }))

  // Determine if column headers are numbers (potential concentrations or time points)
  const colsAreNumeric = colHeaders.every(h => !isNaN(parseFloat(h)))

  // Build pseudo-well data: use "R{row}C{col}" as well IDs
  const wellData  = {}
  const wellNames = {}
  rowLabels.forEach((label, ri) => {
    colHeaders.forEach((col, ci) => {
      const id = `R${ri + 1}C${ci + 1}`
      wellData[id]  = [matrix[ri][ci]]
      wellNames[id] = label || id
    })
  })

  // Determine plate-like dimensions
  const nRows = rowLabels.length
  const nCols = colHeaders.length

  return {
    format: 'matrix',
    fileName,
    meta: { fileName },
    wellIds:    {},
    wellNames,
    readType:   'fluorescence',
    wavelengths: [],
    plateSize:  null,  // not a standard plate — use matrix dimensions
    nRows,
    nCols,
    colHeaders,
    rowLabels,
    matrix,
    isKinetic:  false,
    times:      null,
    temps:      null,
    wellData,
    isMatrix:   true,
  }
}
