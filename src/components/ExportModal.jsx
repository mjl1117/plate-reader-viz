import { useState, useMemo } from 'react'
import { exportPrismCsv, exportPrismXlsx, getPreviewRows } from '../utils/exportPrism.js'

export default function ExportModal({ data, wellNames, onClose }) {
  const [format,   setFormat]   = useState('csv')
  const [timeUnit, setTimeUnit] = useState('auto')

  const preview = useMemo(
    () => getPreviewRows(data, wellNames, timeUnit, 4),
    [data, wellNames, timeUnit]
  )

  const doExport = () => {
    if (format === 'csv') exportPrismCsv(data, wellNames, timeUnit)
    else                  exportPrismXlsx(data, wellNames, timeUnit)
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
          {/* Format */}
          <div className="opt-group">
            <span className="opt-label">Format</span>
            <div className="opt-row">
              {['csv', 'xlsx'].map(f => (
                <button
                  key={f}
                  className={`opt-btn${format === f ? ' active' : ''}`}
                  onClick={() => setFormat(f)}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Time unit (kinetic only) */}
          {data.isKinetic && (
            <div className="opt-group">
              <span className="opt-label">Time unit</span>
              <div className="opt-row">
                {['auto', 'seconds', 'minutes', 'hours'].map(u => (
                  <button
                    key={u}
                    className={`opt-btn${timeUnit === u ? ' active' : ''}`}
                    onClick={() => setTimeUnit(u)}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Table type */}
          <div className="opt-group">
            <span className="opt-label">Prism table</span>
            <span className="opt-tag">{tableType}</span>
          </div>
        </div>

        {/* Preview */}
        <div className="export-preview">
          <div className="preview-label">Preview (first {preview.length - 1} rows)</div>
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
                    {row.length > 9 && (
                      <td className="preview-more">+{row.length - 9}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="modal-footer">
          <span className="footer-note">
            Wells with the same label are grouped as replicates.
          </span>
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn-export" onClick={doExport}>
            Download .{format}
          </button>
        </div>
      </div>
    </div>
  )
}
