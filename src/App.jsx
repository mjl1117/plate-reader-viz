import { useState, useCallback, useMemo } from 'react'
import { parseFile }    from './parsers/index.js'
import DropZone         from './components/DropZone.jsx'
import PlateHeatmap     from './components/PlateHeatmap.jsx'
import KineticChart     from './components/KineticChart.jsx'
import MetaBadges       from './components/MetaBadges.jsx'
import WellLabeler      from './components/WellLabeler.jsx'
import ExportModal      from './components/ExportModal.jsx'

export default function App() {
  const [datasets,      setDatasets]      = useState(null)  // array or null
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState(null)
  const [timeIdx,       setTimeIdx]       = useState(0)
  const [selectedWells, setSelectedWells] = useState(new Set())
  const [customLabels,  setCustomLabels]  = useState({})
  const [showLabeler,   setShowLabeler]   = useState(false)
  const [showExport,    setShowExport]    = useState(false)

  // Primary dataset (first in array) drives all interactive controls
  const data = datasets?.[0] ?? null

  const handleFile = useCallback(async (file) => {
    setLoading(true)
    setError(null)
    setData(null)
    setTimeIdx(0)
    setSelectedWells(new Set())
    setCustomLabels({})
    try {
      const result = await parseFile(file)
      if (result.error) {
        setError(result.message || 'Failed to parse file.')
      } else if (Array.isArray(result)) {
        setDatasets(result)
      } else {
        setDatasets([result])
      }
    } catch (e) {
      setError(`Unexpected error: ${e.message}`)
    }
    setLoading(false)
  }, [])

  const toggleWell = useCallback((pos) => {
    setSelectedWells(prev => {
      const next = new Set(prev)
      next.has(pos) ? next.delete(pos) : next.add(pos)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => setSelectedWells(new Set()), [])

  // Merged names: file-parsed names overridden by user's custom labels
  const mergedNames = useMemo(() => ({
    ...(data?.wellNames ?? {}),
    ...customLabels,
  }), [data, customLabels])

  // Stats for the selected timepoint
  const stats = useMemo(() => {
    if (!data) return null
    const vals = Object.values(data.wellData)
      .map(series => series[timeIdx] ?? null)
      .filter(v => v != null)
    if (!vals.length) return null
    vals.sort((a, b) => a - b)
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length
    const std  = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length)
    return {
      n:      vals.length,
      min:    vals[0],
      max:    vals[vals.length - 1],
      mean,
      std,
      median: vals[Math.floor(vals.length / 2)],
    }
  }, [data, timeIdx])

  const fmtN = (n) => {
    if (n == null || isNaN(n)) return '—'
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M'
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'k'
    return n.toFixed(n < 10 ? 3 : 0)
  }

  const timeLabel = (s) => {
    if (s == null) return ''
    if (s >= 3600) return `${(s / 3600).toFixed(2)} h`
    if (s >= 60)   return `${(s / 60).toFixed(1)} min`
    return `${s} s`
  }

  // ─────────────────────────────────────────────────────────────────────────
  if (!datasets && !loading && !error) {
    return <DropZone onFile={handleFile} />
  }

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-left">
          <span className="app-logo">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="logo-icon">
              <circle cx="10" cy="10" r="9" />
              {[...Array(3)].map((_, r) =>
                [...Array(4)].map((_, c) => (
                  <circle key={`${r}-${c}`} cx={4.5 + c * 4} cy={6 + r * 4} r="1.2" fill="currentColor" stroke="none" />
                ))
              )}
            </svg>
          </span>
          <span className="app-name">Plate Reader Viz</span>
        </div>
        <div className="header-right">
          {data && (
            <>
              <button className="btn-label" onClick={() => setShowLabeler(true)}>
                Label Wells
              </button>
              <button className="btn-export-hdr" onClick={() => setShowExport(true)}>
                Export for Prism
              </button>
            </>
          )}
          <button className="btn-load" onClick={() => { setDatasets(null); setError(null) }}>
            Load New File
          </button>
        </div>
      </header>

      {loading && (
        <div className="loading-bar">
          <div className="loading-inner" />
        </div>
      )}

      {error && (
        <div className="error-banner">
          <svg viewBox="0 0 20 20" fill="currentColor" className="err-icon">
            <path fillRule="evenodd" d="M18 10A8 8 0 1 1 2 10a8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a1 1 0 0 0 0 2v3a1 1 0 0 0 1 1h1a1 1 0 1 0 0-2v-3a1 1 0 0 0-1-1H9Z" clipRule="evenodd"/>
          </svg>
          <pre className="err-msg">{error}</pre>
          <button className="btn-retry" onClick={() => { setError(null) }}>Dismiss</button>
        </div>
      )}

      {data && (
        <>
          <MetaBadges data={data} />

          <div className="main-layout">
            {/* ── Left: Plate Heatmap (skip for sample-based Tecan data) ── */}
            {!data.isSampleBased ? (
              <div className="panel panel-plate">
                <div className="panel-header">
                  <h2 className="panel-title">
                    {data.isMatrix ? 'Data Matrix' : `${data.plateSize}-Well Plate`}
                  </h2>
                  {data.isKinetic && data.times?.length > 1 && (
                    <span className="time-display">
                      t = {timeLabel(data.times[timeIdx])}
                    </span>
                  )}
                  {selectedWells.size > 0 && (
                    <button className="btn-clear" onClick={clearSelection}>
                      Clear selection ({selectedWells.size})
                    </button>
                  )}
                </div>

                <PlateHeatmap
                  wellData={data.wellData}
                  wellNames={mergedNames}
                  plateSize={data.plateSize}
                  readType={data.readType}
                  timeIdx={timeIdx}
                  selectedWells={selectedWells}
                  onWellClick={toggleWell}
                  isMatrix={data.isMatrix}
                  nRows={data.nRows}
                  nCols={data.nCols}
                  rowLabels={data.rowLabels}
                  colHeaders={data.colHeaders}
                />

                {/* Timepoint slider */}
                {data.isKinetic && data.times?.length > 1 && (
                  <div className="time-slider-wrap">
                    <span className="slider-label">{timeLabel(data.times[0])}</span>
                    <input
                      type="range"
                      min={0}
                      max={data.times.length - 1}
                      value={timeIdx}
                      onChange={e => setTimeIdx(Number(e.target.value))}
                      className="time-slider"
                    />
                    <span className="slider-label">{timeLabel(data.times[data.times.length - 1])}</span>
                  </div>
                )}

                {/* Stats bar */}
                {stats && (
                  <div className="stats-bar">
                    {[
                      ['Wells',  stats.n],
                      ['Min',    fmtN(stats.min)],
                      ['Max',    fmtN(stats.max)],
                      ['Mean',   fmtN(stats.mean)],
                      ['SD',     fmtN(stats.std)],
                      ['Median', fmtN(stats.median)],
                    ].map(([label, val]) => (
                      <div key={label} className="stat-cell">
                        <div className="stat-label">{label}</div>
                        <div className="stat-val">{val}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* Sample-based layout (Tecan): show sample list panel instead */
              <div className="panel panel-samples">
                <div className="panel-header">
                  <h2 className="panel-title">Samples</h2>
                  <span className="panel-hint">{Object.keys(data.wellData).length} samples</span>
                </div>
                <SampleList
                  wellData={data.wellData}
                  wellNames={mergedNames}
                  timeIdx={timeIdx}
                  selectedWells={selectedWells}
                  onToggle={toggleWell}
                  fmtN={fmtN}
                />
                {/* Timepoint slider */}
                {data.isKinetic && data.times?.length > 1 && (
                  <div className="time-slider-wrap">
                    <span className="slider-label">{timeLabel(data.times[0])}</span>
                    <input
                      type="range"
                      min={0}
                      max={data.times.length - 1}
                      value={timeIdx}
                      onChange={e => setTimeIdx(Number(e.target.value))}
                      className="time-slider"
                    />
                    <span className="slider-label">{timeLabel(data.times[data.times.length - 1])}</span>
                  </div>
                )}
                {stats && (
                  <div className="stats-bar">
                    {[
                      ['N',      stats.n],
                      ['Min',    fmtN(stats.min)],
                      ['Max',    fmtN(stats.max)],
                      ['Mean',   fmtN(stats.mean)],
                      ['SD',     fmtN(stats.std)],
                      ['Median', fmtN(stats.median)],
                    ].map(([label, val]) => (
                      <div key={label} className="stat-cell">
                        <div className="stat-label">{label}</div>
                        <div className="stat-val">{val}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Right: Chart ── */}
            <div className="panel panel-chart">
              <div className="panel-header">
                <h2 className="panel-title">
                  {data.isKinetic ? 'Signal Over Time' : 'Well Values'}
                </h2>
                {data.isKinetic && (
                  <span className="panel-hint">
                    Click {data.isSampleBased ? 'samples' : 'wells'} to select · showing {selectedWells.size || 'all'} traces
                  </span>
                )}
              </div>

              {data.isKinetic ? (
                <KineticChart
                  wellData={data.wellData}
                  times={data.times}
                  wellNames={mergedNames}
                  selectedWells={selectedWells.size > 0 ? selectedWells : null}
                  readType={data.readType}
                />
              ) : (
                <EndpointTable wellData={data.wellData} wellNames={mergedNames} fmtN={fmtN} />
              )}

              {/* Well identity legend */}
              {Object.keys(mergedNames || {}).length > 0 && (
                <WellLegend wellNames={mergedNames} selectedWells={selectedWells} onToggle={toggleWell} />
              )}
            </div>
          </div>

          {/* ── Additional sections (multi-section files: Soil_GFP, MG_Data, etc.) ── */}
          {datasets && datasets.length > 1 && datasets.slice(1).map((section, idx) => (
            <SectionPanel key={idx} data={section} fmtN={fmtN} timeLabel={timeLabel} />
          ))}

          {/* ── Modals ── */}
          {showLabeler && (
            <WellLabeler
              data={data}
              customLabels={customLabels}
              onSave={(labels) => { setCustomLabels(labels); setShowLabeler(false) }}
              onClose={() => setShowLabeler(false)}
            />
          )}
          {showExport && (
            <ExportModal
              data={data}
              wellNames={mergedNames}
              onClose={() => setShowExport(false)}
            />
          )}
        </>
      )}
    </div>
  )
}

// ── Sample list (Tecan sample-based data) ──────────────────────────────────────
function SampleList({ wellData, wellNames, timeIdx, selectedWells, onToggle, fmtN }) {
  const entries = Object.entries(wellData)
  return (
    <div className="sample-list">
      {entries.map(([id, series]) => {
        const val  = series[timeIdx] ?? null
        const name = wellNames?.[id] || id
        const sel  = selectedWells?.has(id)
        return (
          <div
            key={id}
            className={`sample-row${sel ? ' sample-selected' : ''}`}
            onClick={() => onToggle?.(id)}
          >
            <span className="sample-id">{id}</span>
            <span className="sample-name">{name}</span>
            <span className="sample-val">{fmtN(val)}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Endpoint: sorted table of well values ─────────────────────────────────────
function EndpointTable({ wellData, wellNames, fmtN }) {
  const rows = useMemo(() => {
    return Object.entries(wellData)
      .map(([pos, vals]) => ({ pos, val: vals[0], name: wellNames?.[pos] }))
      .filter(r => r.val != null)
      .sort((a, b) => b.val - a.val)
  }, [wellData, wellNames])

  if (!rows.length) return <p className="no-data">No endpoint data found.</p>

  return (
    <div className="endpoint-table-wrap">
      <table className="endpoint-table">
        <thead>
          <tr>
            <th>Well</th>
            <th>Sample</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 96).map(r => (
            <tr key={r.pos}>
              <td className="cell-mono">{r.pos}</td>
              <td>{r.name || '—'}</td>
              <td className="cell-val">{fmtN(r.val)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Secondary section panel (for multi-section files) ─────────────────────────
function SectionPanel({ data, fmtN, timeLabel }) {
  const [timeIdx, setTimeIdx] = useState(0)
  if (!data) return null

  const label = data.sectionLabel
    || (data.groupIndex != null ? `Group ${data.groupIndex}` : null)
    || data.meta?.experimentName
    || 'Section'

  const wavLabel = data.wavelengths?.length
    ? ` · ${data.wavelengths.join(', ')} nm`
    : ''

  return (
    <div className="section-panel">
      <div className="section-panel-header">
        <h3 className="section-panel-title">{label}{wavLabel}</h3>
        <span className="section-badge">{data.readType}</span>
      </div>
      <div className="main-layout">
        <div className="panel panel-plate">
          <div className="panel-header">
            <h2 className="panel-title">{data.plateSize}-Well Plate</h2>
            {data.isKinetic && data.times?.length > 1 && (
              <span className="time-display">t = {timeLabel(data.times[timeIdx])}</span>
            )}
          </div>
          <PlateHeatmap
            wellData={data.wellData}
            wellNames={data.wellNames}
            plateSize={data.plateSize}
            readType={data.readType}
            timeIdx={timeIdx}
            isMatrix={data.isMatrix}
            nRows={data.nRows}
            nCols={data.nCols}
            rowLabels={data.rowLabels}
            colHeaders={data.colHeaders}
          />
          {data.isKinetic && data.times?.length > 1 && (
            <div className="time-slider-wrap">
              <span className="slider-label">{timeLabel(data.times[0])}</span>
              <input type="range" min={0} max={data.times.length - 1} value={timeIdx}
                onChange={e => setTimeIdx(Number(e.target.value))} className="time-slider" />
              <span className="slider-label">{timeLabel(data.times[data.times.length - 1])}</span>
            </div>
          )}
        </div>
        <div className="panel panel-chart">
          <div className="panel-header">
            <h2 className="panel-title">{data.isKinetic ? 'Signal Over Time' : 'Well Values'}</h2>
          </div>
          {data.isKinetic ? (
            <KineticChart wellData={data.wellData} times={data.times}
              wellNames={data.wellNames} readType={data.readType} />
          ) : (
            <EndpointTable wellData={data.wellData} wellNames={data.wellNames} fmtN={fmtN} />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Well legend for kinetic chart ─────────────────────────────────────────────
const PALETTE = [
  '#63cab7','#4a9eff','#f59e0b','#a78bfa','#f472b6',
  '#34d399','#60a5fa','#fb923c','#818cf8','#2dd4bf',
  '#facc15','#c084fc','#4ade80','#38bdf8','#e879f9',
  '#86efac','#93c5fd','#fcd34d','#d8b4fe','#6ee7b7',
]

function WellLegend({ wellNames, selectedWells, onToggle }) {
  const entries = Object.entries(wellNames).slice(0, 40)
  if (!entries.length) return null
  return (
    <div className="well-legend">
      <div className="legend-title">Sample Map</div>
      <div className="legend-grid">
        {entries.map(([pos, name], i) => (
          <div
            key={pos}
            className={`legend-item${selectedWells?.has(pos) ? ' selected' : ''}`}
            onClick={() => onToggle?.(pos)}
            title={`${pos}: ${name}`}
          >
            <span className="legend-dot" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="legend-pos">{pos}</span>
            <span className="legend-name">{name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
