import { useEffect, useRef, useState } from 'react';
import { db, download, safeName, type Recording } from '../lib/db';
import { INSTRUMENT_LABELS } from '../lib/settings';
import { fmtTime } from '../lib/music';
import { buildMidi } from '../lib/midi';
import { Icon, Modal, Panel, Select } from '../ui/controls';
import { ReportView } from '../ui/ReportView';
import { useProjects, useRecordings, fmtBytes, fmtDate } from '../ui/hooks';
import { BACKING_STYLES } from '../audio/backing';
import type { Nav } from '../App';

/** Single shared audio element so only one recording plays at a time. */
function usePlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [cur, setCur] = useState<string | null>(null);
  const [pos, setPos] = useState(0);
  useEffect(() => {
    const a = new Audio();
    audio.current = a;
    a.ontimeupdate = () => setPos(a.currentTime);
    a.onended = () => { setCur(null); setPos(0); };
    return () => { a.pause(); if (a.src) URL.revokeObjectURL(a.src); };
  }, []);
  const toggle = (r: Recording) => {
    const a = audio.current!;
    if (cur === r.id) { if (a.paused) a.play(); else a.pause(); setCur(a.paused ? cur : r.id); return; }
    if (a.src) URL.revokeObjectURL(a.src);
    a.src = URL.createObjectURL(r.wav);
    a.play();
    setCur(r.id);
    setPos(0);
  };
  const seek = (f: number) => { const a = audio.current!; if (a.duration) a.currentTime = f * a.duration; };
  return { cur, pos, toggle, seek, paused: () => audio.current?.paused ?? true };
}

export function LibraryPage({ nav }: { nav: Nav }) {
  const recs = useRecordings();
  const projects = useProjects();
  const pl = usePlayer();
  const [filter, setFilter] = useState<string>('all');
  const [report, setReport] = useState<Recording | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => { db.usage().then(setUsage); }, [recs]);

  const list = (recs ?? []).filter((r) => filter === 'all' || r.instrument === filter);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Music Library</h1><p>Your recordings and projects. Everything is stored locally in this browser and nothing is uploaded.</p></div>
        <span className="spacer" />
        {usage && <span className="small muted">Storage used {fmtBytes(usage.usage)}{usage.quota ? ` of ${fmtBytes(usage.quota)}` : ''}</span>}
      </div>

      <Panel title={`Recordings · ${recs?.length ?? 0}`} bodyClass="" right={
        <Select value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All instruments' }, ...Object.entries(INSTRUMENT_LABELS).map(([value, label]) => ({ value, label }))]} style={{ width: 170 }} />
      }>
        {!recs ? <div className="empty">Loading…</div> : !list.length ? (
          <div className="empty col" style={{ alignItems: 'center' }}><p>No recordings yet.</p><button className="btn primary" onClick={() => nav('instruments', 'piano')}>Record your first take</button></div>
        ) : (
          <table className="list">
            <thead><tr><th style={{ width: 44 }} /><th>Name</th><th>Instrument</th><th>Duration</th><th>Created</th><th>Score</th><th>Size</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
            <tbody>
              {list.map((r) => {
                const playing = pl.cur === r.id && !pl.paused();
                return (
                  <tr key={r.id}>
                    <td><button className="btn sm icon" onClick={() => pl.toggle(r)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? Icon.pause : Icon.play}</button></td>
                    <td style={{ minWidth: 200 }}>
                      <input className="name-input" defaultValue={r.name} aria-label="Recording name"
                        onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.name) db.putRecording({ ...r, name: v }); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                      {pl.cur === r.id && (
                        <div className="meter" style={{ marginTop: 4, cursor: 'pointer' }} onClick={(e) => { const b = e.currentTarget.getBoundingClientRect(); pl.seek((e.clientX - b.left) / b.width); }}>
                          <i style={{ width: `${(pl.pos / r.duration) * 100}%` }} />
                        </div>
                      )}
                    </td>
                    <td><span className="tag">{INSTRUMENT_LABELS[r.instrument]}</span>{r.backing && <span className="tag" style={{ marginLeft: 4 }}>+ {BACKING_STYLES.find((b) => b.id === r.backing)?.genre}</span>}</td>
                    <td className="mono">{fmtTime(r.duration)}</td>
                    <td className="small muted">{fmtDate(r.createdAt)}</td>
                    <td className="mono">{r.report?.overall ?? '—'}</td>
                    <td className="small muted">{fmtBytes(r.wav.size)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn sm" onClick={() => setReport(r)} title="Performance report">{Icon.chart}</button>{' '}
                      <button className="btn sm" onClick={() => download(r.wav, `${safeName(r.name)}.wav`)} title="Download WAV">{Icon.download}WAV</button>{' '}
                      <button className="btn sm" disabled={!r.events.length} onClick={() => download(buildMidi([{ name: r.name, inst: r.instrument, preset: r.preset, events: r.events }], r.bpm ?? 120), `${safeName(r.name)}.mid`)} title="Export MIDI">{Icon.download}MIDI</button>{' '}
                      <button className="btn sm" onClick={() => nav('studio', `add:${r.id}`)} title="Add to multitrack project">+ Track</button>{' '}
                      <button className="btn sm icon danger" onClick={() => { if (confirm(`Delete "${r.name}"? This cannot be undone.`)) db.deleteRecording(r.id); }} aria-label="Delete">{Icon.trash}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title={`Multitrack projects · ${projects?.length ?? 0}`} bodyClass="">
        {!projects?.length ? <div className="empty">No projects. Build one in the Recording Studio.</div> : (
          <table className="list">
            <thead><tr><th>Project</th><th>Tracks</th><th>Tempo</th><th>Updated</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
            <tbody>{projects.map((p) => (
              <tr key={p.id}>
                <td style={{ fontWeight: 550 }}>{p.name}</td>
                <td className="small">{p.tracks.map((t) => INSTRUMENT_LABELS[t.instrument].replace('Air ', '')).join(', ') || '—'}</td>
                <td className="mono">{p.bpm} · {p.sig}</td>
                <td className="small muted">{fmtDate(p.updatedAt)}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn sm" onClick={() => nav('studio')}>Open studio</button>{' '}
                  <button className="btn sm icon danger" onClick={() => { if (confirm(`Delete project "${p.name}"?`)) db.deleteProject(p.id); }} aria-label="Delete project">{Icon.trash}</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Panel>

      <Panel title="Backing track library">
        <div className="grid3" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
          {BACKING_STYLES.map((b) => (
            <div key={b.id} className="inset" style={{ padding: 12 }}>
              <div className="row"><b>{b.label}</b><span className="spacer" /><span className="tag">{b.genre}</span></div>
              <div className="small muted" style={{ marginTop: 4 }}>{b.desc}</div>
              <div className="tiny faint mono" style={{ marginTop: 6 }}>{b.bpm} BPM · {b.sig} · {b.chords.length}-bar loop</div>
            </div>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>Backing tracks are generated live in the app (drums, bass, keys and pads), so they follow any tempo exactly and loop seamlessly. Turn them on from the transport bar on any instrument.</p>
      </Panel>

      {report && (
        <Modal title={`Report · ${report.name}`} onClose={() => setReport(null)}>
          {report.report ? <ReportView r={report.report} /> : <div className="empty">No report for this recording.</div>}
        </Modal>
      )}
    </div>
  );
}
