import { useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts'

const PALETTE = [
  '#63cab7','#4a9eff','#f59e0b','#a78bfa','#f472b6',
  '#34d399','#60a5fa','#fb923c','#818cf8','#2dd4bf',
  '#facc15','#c084fc','#4ade80','#38bdf8','#e879f9',
  '#86efac','#93c5fd','#fcd34d','#d8b4fe','#6ee7b7',
]

function formatTime(secs) {
  if (secs == null) return ''
  const m = secs / 60
  return m < 1 ? `${secs}s` : `${m.toFixed(1)}m`
}

function formatVal(v) {
  if (v == null) return ''
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + 'M'
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'k'
  return v.toFixed(v < 10 ? 3 : 2)
}

export default function KineticChart({ wellData, times, wellNames, selectedWells, readType }) {
  const wells = useMemo(() => {
    const candidates = selectedWells && selectedWells.size > 0
      ? [...selectedWells]
      : Object.keys(wellData).filter(k => wellData[k].some(v => v != null))
    return candidates.slice(0, 20) // cap at 20 lines for readability
  }, [wellData, selectedWells])

  const chartData = useMemo(() => {
    if (!times || times.length === 0) return []
    return times.map((t, ti) => {
      const pt = { time: t }
      wells.forEach(w => { pt[w] = wellData[w]?.[ti] ?? null })
      return pt
    })
  }, [times, wells, wellData])

  const yLabel = readType === 'absorbance'
    ? 'Absorbance (OD)'
    : readType === 'luminescence'
    ? 'Luminescence (RLU)'
    : 'Fluorescence (RFU)'

  if (!times || times.length === 0) return null

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 24, left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="time"
            type="number"
            scale="linear"
            domain={['dataMin', 'dataMax']}
            tickFormatter={formatTime}
            tick={{ fill: '#718096', fontSize: 11 }}
            label={{ value: 'Time', position: 'insideBottom', offset: -10, fill: '#718096', fontSize: 12 }}
          />
          <YAxis
            tickFormatter={formatVal}
            tick={{ fill: '#718096', fontSize: 11 }}
            label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: 12, fill: '#718096', fontSize: 11 }}
            width={60}
          />
          <Tooltip
            contentStyle={{ background: '#1c2130', border: '1px solid #2a3344', borderRadius: 8 }}
            labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
            labelFormatter={t => `Time: ${formatTime(t)}`}
            formatter={(v, name) => [formatVal(v), wellNames?.[name] ? `${name} (${wellNames[name]})` : name]}
            itemStyle={{ color: '#e2e8f0' }}
          />
          {wells.length <= 10 && (
            <Legend
              wrapperStyle={{ fontSize: 11, color: '#94a3b8', paddingTop: 8 }}
              formatter={(name) => wellNames?.[name] ? `${name} · ${wellNames[name]}` : name}
            />
          )}
          {wells.map((w, i) => (
            <Line
              key={w}
              type="monotone"
              dataKey={w}
              stroke={PALETTE[i % PALETTE.length]}
              dot={false}
              strokeWidth={1.8}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {wells.length === 20 && (
        <p className="chart-note">Showing first 20 wells. Click wells on the plate to select specific ones.</p>
      )}
    </div>
  )
}
