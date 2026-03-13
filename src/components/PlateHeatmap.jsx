import { useState, useMemo } from 'react'

const PLATE_LAYOUTS = {
  6:   { rows: ['A','B'],                                                          numCols: 3  },
  24:  { rows: ['A','B','C','D'],                                                  numCols: 6  },
  96:  { rows: ['A','B','C','D','E','F','G','H'],                                  numCols: 12 },
  384: { rows: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P'], numCols: 24 },
}

function getLayout(plateSize) {
  return PLATE_LAYOUTS[plateSize] || PLATE_LAYOUTS[96]
}

// ── Wavelength → approximate RGB (visible spectrum 380–780 nm) ────────────────
function wavelengthToRGB(nm) {
  if (nm == null) return null
  nm = Math.max(380, Math.min(780, nm))
  let r = 0, g = 0, b = 0
  if      (nm < 440) { r = -(nm-440)/60;    g = 0;           b = 1           }
  else if (nm < 490) { r = 0;               g = (nm-440)/50; b = 1           }
  else if (nm < 510) { r = 0;               g = 1;           b = -(nm-510)/20 }
  else if (nm < 580) { r = (nm-510)/70;     g = 1;           b = 0           }
  else if (nm < 645) { r = 1;               g = -(nm-645)/65; b = 0          }
  else               { r = 1;               g = 0;           b = 0           }

  // Intensity falloff at spectrum edges
  let factor = 1.0
  if      (nm < 420) factor = 0.3 + 0.7 * (nm - 380) / 40
  else if (nm > 700) factor = 0.3 + 0.7 * (780 - nm) / 80

  return [
    Math.round(255 * Math.max(0, Math.min(1, r)) * factor),
    Math.round(255 * Math.max(0, Math.min(1, g)) * factor),
    Math.round(255 * Math.max(0, Math.min(1, b)) * factor),
  ]
}

// Extract emission wavelength from the wavelengths array.
// "480/520" → 520 (emission), "600" → 600 (single), otherwise null.
function getEmissionWavelength(wavelengths) {
  if (!wavelengths?.length) return null
  const w = String(wavelengths[0]).trim()
  if (w.includes('/')) {
    const em = parseInt(w.split('/')[1])
    return (isNaN(em) || em < 300 || em > 800) ? null : em
  }
  const n = parseInt(w)
  return (isNaN(n) || n < 300 || n > 800) ? null : n
}

// ── Color scales ──────────────────────────────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t }

function valueToColor(t, readType, emWavelength) {
  t = Math.max(0, Math.min(1, t))

  // Wavelength-based: dark → spectral color of emission/measurement
  if (emWavelength != null) {
    const rgb = wavelengthToRGB(emWavelength)
    if (rgb) {
      const [wr, wg, wb] = rgb
      return `rgb(${Math.round(lerp(12, wr, t))},${Math.round(lerp(12, wg, t))},${Math.round(lerp(12, wb, t))})`
    }
  }

  // Fallback color schemes by read type
  if (readType === 'fluorescence') {
    const r = Math.round(lerp(15, 16,  t))
    const g = Math.round(lerp(20, 210, t))
    const b = Math.round(lerp(30, 120, t))
    return `rgb(${r},${g},${b})`
  }
  if (readType === 'absorbance') {
    const r = Math.round(lerp(220, 10,  t))
    const g = Math.round(lerp(235, 60, t))
    const b = Math.round(lerp(255, 180, t))
    return `rgb(${r},${g},${b})`
  }
  if (readType === 'luminescence') {
    const r = Math.round(lerp(10,  255, t))
    const g = Math.round(lerp(10,  200, t))
    const b = Math.round(lerp(10,  20,  t))
    return `rgb(${r},${g},${b})`
  }
  const r = Math.round(lerp(60,  255, t))
  const g = Math.round(lerp(20,  100, t))
  const b = Math.round(lerp(120, 60,  t))
  return `rgb(${r},${g},${b})`
}

function textColorFor(t, readType, emWavelength) {
  // When using wavelength colors, always use light text on dark BG
  if (emWavelength != null) return t > 0.3 ? '#0a1929' : '#e2e8f0'
  if (readType === 'absorbance') return t > 0.5 ? '#e2e8f0' : '#0a1929'
  return t > 0.3 ? '#0a1929' : '#e2e8f0'
}

export default function PlateHeatmap({
  wellData, wellNames, plateSize, readType, wavelengths,
  timeIdx = 0, selectedWells, onWellClick,
  isMatrix, nRows, nCols, rowLabels, colHeaders,
}) {
  const [tooltip, setTooltip] = useState(null)

  const emWavelength = useMemo(() => getEmissionWavelength(wavelengths), [wavelengths])

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

    const layout = getLayout(plateSize)
    const rows = layout.rows
    const cols = Array.from({ length: layout.numCols }, (_, i) => String(i + 1))

    const values = {}
    for (const [pos, series] of Object.entries(wellData)) {
      values[pos] = series[timeIdx] ?? null
    }

    const allV = Object.values(values).filter(v => v != null && typeof v === 'number' && !isNaN(v))
    const vMin = allV.length ? Math.min(...allV) : 0
    const vMax = allV.length ? Math.max(...allV) : 1

    return { rows, cols, values, vMin, vMax }
  }, [wellData, plateSize, timeIdx, isMatrix, nRows, nCols])

  const getT = (v) => vMax === vMin ? 0.5 : (v - vMin) / (vMax - vMin)

  // ── SVG layout ─────────────────────────────────────────────────────────────
  const isSmall  = !isMatrix && (plateSize === 384)
  const R        = isSmall ? 10 : 16
  const gap      = isSmall ? 24 : 36
  const padLeft  = isSmall ? 28 : 42
  const padTop   = isSmall ? 22 : 32
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
            fontSize={isSmall ? 7 : 10}
          >
            {isMatrix ? (colHeaders?.[ci] || ci + 1) : c}
          </text>
        ))}

        {/* Row headers + wells */}
        {rows.map((r, ri) => (
          <g key={r}>
            <text
              x={padLeft - (isSmall ? 10 : 14)}
              y={padTop + ri * gap + 4}
              textAnchor="middle"
              className="plate-label"
              fontSize={isSmall ? 7 : 10}
            >
              {isMatrix ? (rowLabels?.[ri] != null ? String(rowLabels[ri]).slice(0, 6) : ri + 1) : r}
            </text>
            {cols.map((c, ci) => {
              const pos = isMatrix ? `R${ri + 1}C${ci + 1}` : `${r}${c}`
              const v   = values[pos]
              const t   = (v != null && typeof v === 'number' && !isNaN(v)) ? getT(v) : -1
              const bg  = t >= 0 ? valueToColor(t, readType, emWavelength) : '#1a2235'
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
                  {!isSmall && v != null && typeof v === 'number' && !isNaN(v) && (
                    <text
                      x={cx} y={cy + 3}
                      textAnchor="middle"
                      fontSize={8}
                      fill={textColorFor(t, readType, emWavelength)}
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
      <ColorBar vMin={vMin} vMax={vMax} readType={readType} emWavelength={emWavelength} />
    </div>
  )
}

function ColorBar({ vMin, vMax, readType, emWavelength }) {
  const steps = 80
  const fmtN = (n) => {
    if (n == null || isNaN(n)) return '—'
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M'
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + 'k'
    return n.toFixed(n < 10 ? 3 : 0)
  }

  const gradient = Array.from({ length: steps }, (_, i) =>
    valueToColor(i / (steps - 1), readType, emWavelength)
  ).join(',')

  return (
    <div className="color-bar">
      <span className="cb-label">{fmtN(vMin)}</span>
      <div className="cb-swatch" style={{ background: `linear-gradient(to right, ${gradient})` }} />
      <span className="cb-label">{fmtN(vMax)}</span>
    </div>
  )
}
