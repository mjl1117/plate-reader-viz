import { useState, useMemo } from 'react'

const ROWS_96  = ['A','B','C','D','E','F','G','H']
const ROWS_384 = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P']

// Color scales ─────────────────────────────────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t }

function valueToColor(t, readType) {
  t = Math.max(0, Math.min(1, t))
  if (readType === 'fluorescence') {
    // Deep charcoal → vivid emerald
    const r = Math.round(lerp(15, 16,  t))
    const g = Math.round(lerp(20, 210, t))
    const b = Math.round(lerp(30, 120, t))
    return `rgb(${r},${g},${b})`
  }
  if (readType === 'absorbance') {
    // Pale sky-blue → deep navy
    const r = Math.round(lerp(220, 10,  t))
    const g = Math.round(lerp(235, 60, t))
    const b = Math.round(lerp(255, 180, t))
    return `rgb(${r},${g},${b})`
  }
  if (readType === 'luminescence') {
    // Near-black → bright amber
    const r = Math.round(lerp(10,  255, t))
    const g = Math.round(lerp(10,  200, t))
    const b = Math.round(lerp(10,  20,  t))
    return `rgb(${r},${g},${b})`
  }
  // Default: indigo → coral
  const r = Math.round(lerp(60,  255, t))
  const g = Math.round(lerp(20,  100, t))
  const b = Math.round(lerp(120, 60,  t))
  return `rgb(${r},${g},${b})`
}

function textColorFor(t, readType) {
  // Dark text on light backgrounds, light on dark
  if (readType === 'absorbance') return t > 0.5 ? '#e2e8f0' : '#0a1929'
  return t > 0.3 ? '#0a1929' : '#e2e8f0'
}

export default function PlateHeatmap({
  wellData, wellNames, plateSize, readType,
  timeIdx = 0, selectedWells, onWellClick,
  isMatrix, nRows, nCols, rowLabels, colHeaders,
}) {
  const [tooltip, setTooltip] = useState(null)

  // ── Build display data ─────────────────────────────────────────────────────
  const { rows, cols, values, vMin, vMax } = useMemo(() => {
    if (isMatrix) {
      const rows = Array.from({ length: nRows }, (_, i) => String(i))
      const cols = Array.from({ length: nCols }, (_, i) => String(i))
      const values = {}
      for (let r = 0; r < nRows; r++) {
        for (let c = 0; c < nCols; c++) {
          const id = `R${r + 1}C${c + 1}`
          values[id] = wellData[id]?.[0] ?? null
        }
      }
      const allV = Object.values(values).filter(v => v != null)
      return { rows, cols, values, vMin: Math.min(...allV), vMax: Math.max(...allV) }
    }

    const ROWS = plateSize === 384 ? ROWS_384 : ROWS_96
    const COLS = plateSize === 384 ? 24 : 12

    const rows = ROWS
    const cols = Array.from({ length: COLS }, (_, i) => String(i + 1))

    const values = {}
    for (const [pos, series] of Object.entries(wellData)) {
      values[pos] = series[timeIdx] ?? null
    }

    const allV = Object.values(values).filter(v => v != null)
    const vMin = allV.length ? Math.min(...allV) : 0
    const vMax = allV.length ? Math.max(...allV) : 1

    return { rows, cols, values, vMin, vMax }
  }, [wellData, plateSize, timeIdx, isMatrix, nRows, nCols])

  const getT = (v) => vMax === vMin ? 0.5 : (v - vMin) / (vMax - vMin)

  // ── SVG layout ─────────────────────────────────────────────────────────────
  const is384    = !isMatrix && plateSize === 384
  const R        = is384 ? 10 : 16   // well circle radius
  const gap      = is384 ? 24 : 36   // well center spacing
  const padLeft  = is384 ? 28 : 42
  const padTop   = is384 ? 22 : 32
  const svgW     = padLeft + cols.length * gap + 12
  const svgH     = padTop  + rows.length * gap + 12

  const fmtVal = (v) => {
    if (v == null) return '—'
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + 'M'
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'k'
    return v.toFixed(v < 10 ? 3 : 0)
  }

  return (
    <div className="heatmap-container">
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        width={svgW}
        height={svgH}
        className="plate-svg"
        style={{ maxWidth: '100%' }}
      >
        {/* Column headers */}
        {cols.map((c, ci) => (
          <text
            key={c}
            x={padLeft + ci * gap}
            y={padTop - 6}
            textAnchor="middle"
            className="plate-label"
            fontSize={is384 ? 7 : 10}
          >
            {isMatrix ? (colHeaders?.[ci] || ci + 1) : c}
          </text>
        ))}

        {/* Row headers + wells */}
        {rows.map((r, ri) => (
          <g key={r}>
            <text
              x={padLeft - (is384 ? 10 : 14)}
              y={padTop + ri * gap + 4}
              textAnchor="middle"
              className="plate-label"
              fontSize={is384 ? 7 : 10}
            >
              {isMatrix ? (rowLabels?.[ri] != null ? String(rowLabels[ri]).slice(0, 6) : ri + 1) : r}
            </text>
            {cols.map((c, ci) => {
              const pos = isMatrix ? `R${ri + 1}C${ci + 1}` : `${r}${c}`
              const v   = values[pos]
              const t   = v != null ? getT(v) : -1
              const bg  = t >= 0 ? valueToColor(t, readType) : '#1a2235'
              const isSelected = selectedWells?.has(pos)
              const cx  = padLeft + ci * gap
              const cy  = padTop  + ri * gap

              return (
                <g key={pos}
                  onClick={() => onWellClick?.(pos)}
                  onMouseEnter={e => setTooltip({ pos, v, name: wellNames?.[pos], x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setTooltip(null)}
                  style={{ cursor: 'pointer' }}
                >
                  {isSelected && (
                    <circle cx={cx} cy={cy} r={R + 3} fill="none" stroke="#63cab7" strokeWidth={1.5} />
                  )}
                  <circle
                    cx={cx} cy={cy} r={R}
                    fill={bg}
                    stroke={isSelected ? '#63cab7' : (t >= 0 ? 'rgba(255,255,255,0.06)' : '#1e2d42')}
                    strokeWidth={isSelected ? 1.5 : 0.5}
                  />
                  {!is384 && v != null && (
                    <text
                      x={cx} y={cy + 3}
                      textAnchor="middle"
                      fontSize={8}
                      fill={textColorFor(t, readType)}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {fmtVal(v)}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        ))}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="well-tooltip"
          style={{ left: tooltip.x + 14, top: tooltip.y - 14, position: 'fixed' }}
        >
          <div className="tt-pos">{tooltip.pos}</div>
          {tooltip.name && <div className="tt-name">{tooltip.name}</div>}
          <div className="tt-val">{fmtVal(tooltip.v)}</div>
        </div>
      )}

      {/* Color bar */}
      <ColorBar vMin={vMin} vMax={vMax} readType={readType} />
    </div>
  )
}

function ColorBar({ vMin, vMax, readType }) {
  const steps = 80
  const fmtN = (n) => {
    if (n == null || isNaN(n)) return '—'
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M'
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + 'k'
    return n.toFixed(n < 10 ? 3 : 0)
  }

  const gradient = Array.from({ length: steps }, (_, i) =>
    valueToColor(i / (steps - 1), readType)
  ).join(',')

  return (
    <div className="color-bar">
      <span className="cb-label">{fmtN(vMin)}</span>
      <div className="cb-swatch" style={{ background: `linear-gradient(to right, ${gradient})` }} />
      <span className="cb-label">{fmtN(vMax)}</span>
    </div>
  )
}
