import { useState, useCallback } from 'react'

export default function DropZone({ onFile }) {
  const [dragging, setDragging] = useState(false)

  const handle = useCallback((file) => {
    if (file) onFile(file)
  }, [onFile])

  const onDrop = useCallback(e => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    handle(file)
  }, [handle])

  const onInput = useCallback(e => {
    handle(e.target.files[0])
  }, [handle])

  return (
    <div className="dropzone-wrapper">
      <div className="dropzone-hero">
        <div className="hero-glow" />
        <svg className="hero-icon" viewBox="0 0 80 80" fill="none">
          <circle cx="40" cy="40" r="38" stroke="url(#grad1)" strokeWidth="1.5" />
          {[...Array(8)].map((_, r) =>
            [...Array(12)].map((_, c) => (
              <circle
                key={`${r}-${c}`}
                cx={14 + c * 5}
                cy={16 + r * 6}
                r="1.5"
                fill={`rgba(99,202,183,${0.1 + Math.random() * 0.5})`}
              />
            ))
          )}
          <defs>
            <linearGradient id="grad1" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#63cab7" />
              <stop offset="100%" stopColor="#4a9eff" />
            </linearGradient>
          </defs>
        </svg>
        <h1 className="hero-title">Plate Reader Visualizer</h1>
        <p className="hero-sub">Auto-detects BioTek Gen5 CSV, Excel, and TXT exports</p>

        <div
          className={`dropzone${dragging ? ' dragging' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => document.getElementById('fileInput').click()}
        >
          <div className="dz-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 16V8m0 0-3 3m3-3 3 3" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <p className="dz-main">
            {dragging ? 'Drop to load' : 'Drop your file here'}
          </p>
          <p className="dz-sub">or click to browse — .csv  .txt  .xlsx  .xls</p>
        </div>

        <input
          id="fileInput"
          type="file"
          accept=".csv,.txt,.xlsx,.xls,.tsv,.xpt"
          style={{ display: 'none' }}
          onChange={onInput}
        />

        <div className="format-chips">
          {[
            { label: 'Kinetic Fluorescence', color: '#63cab7' },
            { label: 'Kinetic Absorbance', color: '#4a9eff' },
            { label: 'Endpoint Reads', color: '#a78bfa' },
            { label: 'Luminescence', color: '#fbbf24' },
            { label: '96-well & 384-well', color: '#6b7280' },
          ].map(f => (
            <span key={f.label} className="format-chip" style={{ '--chip-color': f.color }}>
              {f.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
