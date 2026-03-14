import { useState, useMemo } from 'react'
import * as XLSX from 'xlsx'
import {
  exportPrismCsv, exportPrismXlsx, getPreviewRows,
  buildChannelLabel, buildKineticRows, buildEndpointRows,
} from '../utils/exportPrism.js'

function safeFilename(s) {
  return (s || 'channel').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'channel'
}

function makeBaseFilename(data) {
  return (data.meta?.experimentName || data.fileName?.replace(/\.[^.]+$/, '') || 'export')
    .replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_')
}

function rowsToCsv(rows) {
  return rows.map(row =>
    row.map(v => {
      const s = v == null ? '' : String(v)
      if (s.includes(',') || s.includes('"') || s.includes('\n'))
        return '"' + s.replace(/"/g, '""') + '"'
      return s
    }).join(',')
  ).join('\n')
}

function exportDataset(d, wellNames, format, unitPref, overrideFilename) {
  const rows = d.isKinetic
    ? buildKineticRows(d.wellData, d.times, wellNames, unitPref, d)
    : buildEndpointRows(d.wellData, wellNames, d)
  if (format === 'csv') {
    const blob = new Blob([rowsToCsv(rows)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = overrideFilename; a.click()
    URL.revokeObjectURL(url)
  } else {
    exportPrismXlsx(d, wellNames, unitPref, overrideFilename)
  }
}

export default function ExportModal({ data, datasets, wellNames, onClose }) {
  const [format,   setFormat]   = useState('csv')
  const [timeUnit, setTimeUnit] = useState('auto')
  const [scope,    setScope]    = useState(datasets?.length > 1 ? 'separate' : 'single')

  const hasMultiple = datasets && datasets.length > 1

  const preview = useMemo(
    () => getPreviewRows(data, wellNames, timeUnit, 4),
    [data, wellNames, timeUnit]
  )

  const channelName = (d, i) =>
    buildChannelLabel(d) || d.sectionLabel || `Channel_${i + 1}`

  const doExport = () => {
    if (scope === 'single') {
      if (format === 'csv') exportPrismCsv(data, wellNames, timeUnit)
      else                  exportPrismXlsx(data, wellNames, timeUnit)

    } else if (scope === 'separate') {
      datasets.forEach((d, i) => {
        const wn   = i === 0 ? wellNames : (d.wellNames ?? {})
        const base = makeBaseFilename(d)
        const ch   = safeFilename(channelName(d, i))
        exportDataset(d, wn, format, timeUnit, `${base}_${ch}_prism.${format}`)
      })

    } else {
      // combined: one xlsx, one sheet per channel
      const wb = XLSX.utils.book_new()
      datasets.forEach((d, i) => {
        const wn   = i === 0 ? wellNames : (d.wellNames ?? {})
        const rows = d.isKinetic
          ? buildKineticRows(d.wellData, d.times, wn, timeUnit, d)
          : buildEndpointRows(d.wellData, wn, d)
        const ws = XLSX.utils.aoa_to_sheet(rows)
        XLSX.utils.book_append_sheet(wb, ws, channelName(d, i).slice(0, 31))
      })
      XLSX.writeFile(wb, `${makeBaseFilename(datasets[0])}_prism_combined.xlsx`)
    }
    onClose()
  }

  const tableType = data.isKinetic
    ? 'XY scatter (kinetic traces, replicates grouped)'
    : 'Column / bar chart (one column per sample)'

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel export-panel">
        <div className="modal-header">
          <h2 className="modal-title">Export for GraphPad Prism</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="export-options">
          {/* Multi-dataset scope */}
          {hasMultiple && (
            <div className="opt-group">
              <span className="opt-label">Channels</span>
              <div className="opt-row">
                {[
                  ['separate', 'Separate files'],
                  ['combined', 'Combined .xlsx'],
                  ['single',   'Primary only'],
                ].map(([v, label]) => (
                  <button key={v}
                    className={`opt-btn${scope === v ? ' active' : ''}`}
                    onClick={() => setScope(v)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="opt-channel-list">
                {datasets.map((d, i) => (
                  <span key={i} className="opt-channel-tag">{channelName(d, i)}</span>
                ))}
              </div>
            </div>
          )}

          {/* Format (not shown for combined xlsx) */}
          {scope !== 'combined' && (
            <div className="opt-group">
              <span className="opt-label">Format</span>
              <div className="opt-row">
                {['csv', 'xlsx'].map(f => (
                  <button key={f}
                    className={`opt-btn${format === f ? ' active' : ''}`}
                    onClick={() => setFormat(f)}>
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Time unit */}
          {data.isKinetic && (
            <div className="opt-group">
              <span className="opt-label">Time unit</span>
              <div className="opt-row">
                {['auto', 'seconds', 'minutes', 'hours'].map(u => (
                  <button key={u}
                    className={`opt-btn${timeUnit === u ? ' active' : ''}`}
                    onClick={() => setTimeUnit(u)}>
                    {u}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="opt-group">
            <span className="opt-label">Prism table</span>
            <span className="opt-tag">{tableType}</span>
          </div>
        </div>

        {/* Preview */}
        <div className="export-preview">
          <div className="preview-label">Preview — primary channel (first {preview.length - 1} rows)</div>
          <div className="preview-scroll">
            <table className="preview-table">
              <tbody>
                {preview.map((row, ri) => (
                  <tr key={ri} className={ri === 0 ? 'preview-head-row' : ''}>
                    {row.slice(0, 9).map((cell, ci) => (
                      <td key={ci}>
                        {cell === '' || cell == null
                          ? <span className="preview-empty">—</span>
                          : String(cell).length > 18
                            ? String(cell).slice(0, 16) + '…'
                            : String(cell)}
                      </td>
                    ))}
                    {row.length > 9 && <td className="preview-more">+{row.length - 9}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="modal-footer">
          <span className="footer-note">
            {scope === 'separate'
              ? `${datasets?.length} files will download, one per channel.`
              : scope === 'combined'
              ? `1 .xlsx with ${datasets?.length} sheets.`
              : 'Wells with same label are grouped as replicates.'}
          </span>
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn-export" onClick={doExport}>
            {scope === 'separate'
              ? `Download ${datasets?.length} files`
              : scope === 'combined'
              ? 'Download combined .xlsx'
              : `Download .${format}`}
          </button>
        </div>
      </div>
    </div>
  )
}
