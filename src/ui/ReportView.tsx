import { useState } from 'react';
import type { PerformanceReport } from '../practice/scoring';
import { fmtTime } from '../lib/music';

function Metric({ label, value, unit, hint }: { label: string; value: number | null | undefined; unit?: string; hint?: string }) {
  return (
    <div className="metric" title={hint}>
      <span className="label">{label}</span>
      {value === null || value === undefined ? <span className="v na">Not applicable</span> : <span className="v">{value}{unit && <span className="small muted"> {unit}</span>}</span>}
    </div>
  );
}

/** Timing-offset strip: each played target's offset from the beat, with the "perfect" window shaded. */
function OffsetChart({ offsets, window: win }: { offsets: number[]; window: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (offsets.length < 2) return null;
  const W = 720, H = 150, padL = 44, padR = 10, padT = 12, padB = 22;
  const lim = Math.max(win * 2, ...offsets.map((o) => Math.abs(o))) * 1.1;
  const x = (i: number) => padL + (i / Math.max(1, offsets.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v + lim) / (2 * lim)) * (H - padT - padB);
  const ticks = [-Math.round(lim * 0.8 / 10) * 10, 0, Math.round(lim * 0.8 / 10) * 10];
  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="label" style={{ marginBottom: 6 }}>Timing offset per note (ms, + = late)</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Timing offset per note">
        <rect x={padL} y={y(win)} width={W - padL - padR} height={y(-win) - y(win)} fill="rgba(242,240,234,0.06)" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#5a5a5a' : '#2f2f2f'} strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 4} fill="#A5A5A5" fontSize="10" textAnchor="end" fontFamily="var(--mono)">{t > 0 ? `+${t}` : t}</text>
          </g>
        ))}
        <text x={W - padR} y={y(win) - 4} fill="#A5A5A5" fontSize="10" textAnchor="end">±{win} ms window</text>
        <polyline points={offsets.map((o, i) => `${x(i)},${y(o)}`).join(' ')} fill="none" stroke="rgba(214,138,72,0.35)" strokeWidth={1.5} />
        {offsets.map((o, i) => (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <circle cx={x(i)} cy={y(o)} r={10} fill="transparent" />
            <circle cx={x(i)} cy={y(o)} r={hover === i ? 5.5 : 4} fill="#D68A48" stroke="#282828" strokeWidth={2} />
          </g>
        ))}
        {hover !== null && (
          <g pointerEvents="none">
            <rect x={Math.min(W - 120, x(hover) + 8)} y={Math.max(2, y(offsets[hover]) - 30)} width={110} height={24} rx={2} fill="#151515" stroke="#474747" />
            <text x={Math.min(W - 120, x(hover) + 8) + 8} y={Math.max(2, y(offsets[hover]) - 30) + 16} fill="#F2F0EA" fontSize="11">Note {hover + 1}: {offsets[hover] > 0 ? '+' : ''}{Math.round(offsets[hover])} ms</text>
          </g>
        )}
        <text x={padL} y={H - 6} fill="#6f6f6f" fontSize="10">first</text>
        <text x={W - padR} y={H - 6} fill="#6f6f6f" fontSize="10" textAnchor="end">last</text>
      </svg>
    </figure>
  );
}

export function ReportView({ r }: { r: PerformanceReport }) {
  const practice = r.kind === 'practice';
  const win = r.level === 'advanced' ? 35 : 60;
  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="report-top">
        <div className="col" style={{ gap: 4 }}>
          <span className="label">Overall score</span>
          <span className="score-big">{r.overall ?? '—'}</span>
        </div>
        <div className="col" style={{ gap: 4 }}>
          <span className="grade">Grade <b style={{ color: 'var(--text)' }}>{r.grade}</b></span>
          <span className="small muted">{r.title}{r.level ? ` · ${r.level}` : ''}</span>
          <span className="small muted">Duration {fmtTime(r.duration)} · {r.events} events played</span>
        </div>
      </div>
      {practice ? (
        <div className="metrics">
          <Metric label="Note accuracy" value={r.noteAccuracy} unit="%" hint="Targets played correctly within the timing window" />
          <Metric label="Timing accuracy" value={r.timingAccuracy} unit="%" hint="Closeness to the beat for correct notes" />
          <Metric label="Rhythm consistency" value={r.rhythmConsistency} unit="%" hint="How even your timing was (spread of offsets)" />
          <Metric label="Average offset" value={r.meanOffsetMs} unit="ms" />
          <Metric label="Correct" value={r.correct} unit={`/ ${r.targets}`} />
          <Metric label="Missed notes" value={r.missed} />
          <Metric label="Wrong notes" value={r.wrong} />
          <Metric label="Accidental triggers" value={r.accidental} />
        </div>
      ) : (
        <div className="metrics">
          <Metric label="Timing accuracy" value={r.timingAccuracy} unit="%" hint="Closeness to the nearest 8th note of the grid" />
          <Metric label="Rhythm consistency" value={r.rhythmConsistency} unit="%" />
          <Metric label="Average offset" value={r.meanOffsetMs} unit="ms" />
          <Metric label="Accidental triggers" value={r.accidental} />
        </div>
      )}
      {practice && (
        <div className="row small muted" style={{ marginTop: -8, gap: 18 }}>
          <span>On time <b className="mono" style={{ color: 'var(--text)' }}>{r.perfect}</b></span>
          <span>Early <b className="mono" style={{ color: 'var(--text)' }}>{r.early}</b></span>
          <span>Late <b className="mono" style={{ color: 'var(--text)' }}>{r.late}</b></span>
          <span>Spread <b className="mono" style={{ color: 'var(--text)' }}>{r.stdOffsetMs ?? '—'}</b> ms</span>
        </div>
      )}
      <OffsetChart offsets={r.offsets} window={practice ? win : 40} />
      {r.notes.map((n) => <div key={n} className="alert"><span className="dot" />{n}</div>)}
      <div className="col" style={{ gap: 8 }}>
        <span className="label">Recommendations</span>
        <ul className="recs">{r.recommendations.map((x) => <li key={x}>{x}</li>)}</ul>
      </div>
      {r.perKey.length > 0 && (
        <div className="inset">
          <table className="list">
            <thead><tr><th>Note / piece</th><th>Targets</th><th>Hit</th><th>Missed</th><th>Hit rate</th></tr></thead>
            <tbody>
              {r.perKey.map((k) => (
                <tr key={k.key}><td>{k.label}</td><td className="mono">{k.total}</td><td className="mono">{k.hit}</td><td className="mono">{k.missed}</td><td className="mono">{Math.round((k.hit / k.total) * 100)}%</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
