import * as XLSX from 'xlsx'

// ── Time helpers ──────────────────────────────────────────────────────────────

function resolveTimeUnit(times, unitPref) {
  if (unitPref === 'seconds') return 'seconds'
  if (unitPref === 'minutes') return 'minutes'
  if (unitPref === 'hours')   return 'hours'
  // auto
  const max = Math.max(...times)
  if (max >= 3600) return 'hours'
  if (max >= 60)   return 'minutes'
  return 'seconds'
}

function convertTime(seconds, unit) {
  if (unit === 'minutes') return +(seconds / 60).toFixed(6)
  if (unit === 'hours')   return +(seconds / 3600).toFixed(6)
  return seconds
}

// ── Group wells by sample name (replicates share a name) ─────────────────────

function groupWells(wellData, wellNames) {
  const groups = {}   // displayName → [wellId, ...]
  for (const id of Object.keys(wellData)) {
    const name = wellNames?.[id]?.trim() || id
    if (!groups[name]) groups[name] = []
    groups[name].push(id)
  }
  return groups
}

// ── Row builders ──────────────────────────────────────────────────────────────

export function buildKineticRows(wellData, times, wellNames, unitPref = 'auto') {
  const unit   = resolveTimeUnit(times, unitPref)
  const groups = groupWells(wellData, wellNames)
  const names  = Object.keys(groups)

  // Header: X (unit), GroupA, GroupA, GroupA, GroupB, ...
  const header = [`X (${unit})`]
  for (const n of names) {
    for (let r = 0; r < groups[n].length; r++) header.push(n)
  }

  const rows = [header]
  for (let ti = 0; ti < times.length; ti++) {
    const row = [convertTime(times[ti], unit)]
    for (const n of names) {
      for (const id of groups[n]) {
        const v = wellData[id]?.[ti]
        row.push(v == null ? '' : v)
      }
    }
    rows.push(row)
  }
  return rows
}

export function buildEndpointRows(wellData, wellNames) {
  const groups = groupWells(wellData, wellNames)
  const names  = Object.keys(groups)
  const maxLen = Math.max(...names.map(n => groups[n].length))

  const rows = [names]
  for (let r = 0; r < maxLen; r++) {
    rows.push(names.map(n => {
      const id = groups[n][r]
      if (!id) return ''
      const v  = wellData[id]?.[0]
      return v == null ? '' : v
    }))
  }
  return rows
}

export function getPreviewRows(data, wellNames, unitPref = 'auto', maxDataRows = 4) {
  const rows = data.isKinetic
    ? buildKineticRows(data.wellData, data.times, wellNames, unitPref)
    : buildEndpointRows(data.wellData, wellNames)
  return rows.slice(0, maxDataRows + 1)
}

// ── Export functions ──────────────────────────────────────────────────────────

function rowsToCsv(rows) {
  return rows.map(row =>
    row.map(v => {
      const s = v == null ? '' : String(v)
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"'
      }
      return s
    }).join(',')
  ).join('\n')
}

function makeFilename(data, ext) {
  const base = (data.meta?.experimentName || data.fileName?.replace(/\.[^.]+$/, '') || 'export')
    .replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_')
  return `${base}_prism.${ext}`
}

export function exportPrismCsv(data, wellNames, unitPref = 'auto') {
  const rows = data.isKinetic
    ? buildKineticRows(data.wellData, data.times, wellNames, unitPref)
    : buildEndpointRows(data.wellData, wellNames)
  const csv  = rowsToCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = makeFilename(data, 'csv')
  a.click()
  URL.revokeObjectURL(url)
}

export function exportPrismXlsx(data, wellNames, unitPref = 'auto') {
  const rows = data.isKinetic
    ? buildKineticRows(data.wellData, data.times, wellNames, unitPref)
    : buildEndpointRows(data.wellData, wellNames)
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Prism Export')
  XLSX.writeFile(wb, makeFilename(data, 'xlsx'))
}
