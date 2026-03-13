const TYPE_COLORS = {
  fluorescence: '#63cab7',
  absorbance:   '#4a9eff',
  luminescence: '#fbbf24',
  unknown:      '#6b7280',
}

export default function MetaBadges({ data }) {
  if (!data) return null
  const { meta, readType, wavelengths, plateSize, isKinetic, times } = data

  const readLabel = isKinetic
    ? `Kinetic ${readType}`
    : `Endpoint ${readType}`

  const wavLabel = wavelengths?.length
    ? wavelengths.join(' / ') + ' nm'
    : null

  const duration = times?.length
    ? (() => {
        const last = times[times.length - 1]
        if (last >= 3600) return `${(last / 3600).toFixed(1)} h`
        if (last >= 60)   return `${(last / 60).toFixed(0)} min`
        return `${last} s`
      })()
    : null

  const badges = [
    meta?.experimentName && { label: meta.experimentName, key: 'name', style: 'name' },
    meta?.instrument     && { label: meta.instrument,    key: 'inst', icon: '🔬' },
    meta?.date           && { label: meta.date,          key: 'date', icon: '📅' },
    plateSize            && { label: `${plateSize}-well`, key: 'plate' },
    { label: readLabel,    key: 'type',     color: TYPE_COLORS[readType] || '#6b7280' },
    wavLabel             && { label: wavLabel,  key: 'wav' },
    duration             && { label: duration,   key: 'dur', icon: '⏱' },
    times?.length        && { label: `${times.length} reads`, key: 'reads' },
    meta?.plateType      && { label: meta.plateType.split(' ').slice(0, 3).join(' '), key: 'ptype' },
  ].filter(Boolean)

  return (
    <div className="meta-bar">
      {badges.map(b => (
        <span
          key={b.key}
          className={`meta-badge${b.style === 'name' ? ' badge-name' : ''}`}
          style={b.color ? { borderColor: b.color + '55', color: b.color } : {}}
        >
          {b.icon && <span className="badge-icon">{b.icon}</span>}
          {b.label}
        </span>
      ))}
    </div>
  )
}
