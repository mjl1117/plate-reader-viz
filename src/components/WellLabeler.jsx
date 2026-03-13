import { useState, useMemo } from 'react'

export default function WellLabeler({ data, customLabels, onSave, onClose }) {
  // Merge wellNames (from file) with any custom overrides
  const [labels, setLabels] = useState(() => ({
    ...data.wellNames,
    ...customLabels,
  }))
  const [bulkName,  setBulkName]  = useState('')
  const [selected,  setSelected]  = useState(new Set())
  const [filter,    setFilter]    = useState('')

  const wellIds = useMemo(() => Object.keys(data.wellData), [data])

  const visible = useMemo(() => {
    if (!filter.trim()) return wellIds
    const q = filter.toLowerCase()
    return wellIds.filter(id =>
      id.toLowerCase().includes(q) ||
      (labels[id] || '').toLowerCase().includes(q)
    )
  }, [wellIds, labels, filter])

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(visible))
  const clearSel  = () => setSelected(new Set())

  const applyBulk = () => {
    if (!bulkName.trim() || selected.size === 0) return
    const name = bulkName.trim()
    setLabels(prev => {
      const next = { ...prev }
      for (const id of selected) next[id] = name
      return next
    })
    setSelected(new Set())
    setBulkName('')
  }

  const updateLabel = (id, val) => {
    setLabels(prev => ({ ...prev, [id]: val }))
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel labeler-panel">
        <div className="modal-header">
          <h2 className="modal-title">Label Wells / Samples</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Bulk-assign toolbar */}
        <div className="labeler-toolbar">
          <input
            className="toolbar-filter"
            placeholder="Filter…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <span className="toolbar-divider" />
          <button className="toolbar-btn" onClick={selected.size > 0 ? clearSel : selectAll}>
            {selected.size > 0 ? `Clear (${selected.size})` : 'Select all'}
          </button>
          <input
            className="bulk-input"
            placeholder="Sample name…"
            value={bulkName}
            onChange={e => setBulkName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applyBulk()}
          />
          <button
            className="btn-assign"
            disabled={selected.size === 0 || !bulkName.trim()}
            onClick={applyBulk}
          >
            Assign to {selected.size || '…'}
          </button>
        </div>

        {/* Scrollable well list */}
        <div className="labeler-list">
          <div className="labeler-list-header">
            <span className="lh-id">ID</span>
            <span className="lh-name">Sample Name</span>
          </div>
          {visible.map(id => (
            <div
              key={id}
              className={`labeler-row${selected.has(id) ? ' row-selected' : ''}`}
              onClick={() => toggleSelect(id)}
            >
              <span className="row-id">{id}</span>
              <input
                className="row-input"
                value={labels[id] || ''}
                placeholder="—"
                onClick={e => e.stopPropagation()}
                onChange={e => updateLabel(id, e.target.value)}
              />
            </div>
          ))}
          {visible.length === 0 && (
            <p className="labeler-empty">No wells match your filter.</p>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn-save" onClick={() => onSave(labels)}>
            Save Labels
          </button>
        </div>
      </div>
    </div>
  )
}
