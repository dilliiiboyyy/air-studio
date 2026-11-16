import { useState } from 'react';
import { useSettings, INSTRUMENT_LABELS } from '../lib/settings';
import { INSTRUMENTS } from '../instruments';
import { InstrumentGlyph, Icon, Panel } from '../ui/controls';
import { useAudioStatus, useRecordings, useTrackerStatus, fmtDate } from '../ui/hooks';
import { engine } from '../audio/engine';
import { fmtTime } from '../lib/music';
import { getProgress, LESSONS } from '../practice/lessons';
import type { Nav } from '../App';

export function HomePage({ nav }: { nav: Nav }) {
  const recs = useRecordings();
  const audio = useAudioStatus();
  const cam = useTrackerStatus();
  const calibrated = useSettings((s) => s.tracking.calibrated);
  const latency = useSettings((s) => s.tracking.latencyMs);
  const [playing, setPlaying] = useState<{ id: string; a: HTMLAudioElement } | null>(null);
  const progress = getProgress();
  const done = Object.values(progress).filter((p) => p.completed).length;

  const camText: Record<string, [string, string]> = {
    idle: ['Ready, off until you play', ''], loading: ['Loading model…', 'warn'], starting: ['Connecting…', 'warn'], running: ['Active', 'live'],
    denied: ['Permission denied', 'err'], nocamera: ['No camera found', 'err'], inuse: ['In use by another app', 'err'], error: ['Error', 'err'], sim: ['Simulated hands', 'warn'],
  };
  const [ct, cc] = camText[cam] ?? ['—', ''];

  return (
    <div className="page">
      <section className="panel hero">
        <div className="hero-l">
          <span className="label">Air Studio</span>
          <h1>Play piano, drums, guitar and synth in the air.</h1>
          <p>Your webcam tracks both hands and turns their movement into music: keys, drum hits, strums and synth sweeps. Record takes, layer tracks, jam with a backing band and practise with guided lessons. Everything runs locally in your browser.</p>
          <div className="row wrap">
            <button className="btn primary lg" onClick={() => nav(calibrated ? 'instruments' : 'calibrate', 'piano')}>{Icon.play}{calibrated ? 'Quick start · Air Piano' : 'Quick start · calibrate first'}</button>
            <button className="btn lg" onClick={() => nav('practice')}>{Icon.practice}Practice mode</button>
            <button className="btn lg" onClick={() => nav('studio')}>{Icon.studio}Recording studio</button>
          </div>
        </div>
        <div className="hero-r">
          <div className="steps">
            {[
              ['Calibrate', 'Check lighting, distance, your reach and latency. About a minute.', calibrated],
              ['Pick an instrument', 'Each instrument shows its play zones over your camera view.', false],
              ['Play & record', 'Use the metronome or a backing track, then record takes to your library.', (recs?.length ?? 0) > 0],
              ['Practise', `Guided lessons with real-time feedback. ${done}/${LESSONS.length} completed.`, done > 0],
            ].map(([t, d, ok], i) => (
              <div className={`step ${ok ? 'done' : ''}`} key={i}>
                <span className="n">{ok ? '✓' : i + 1}</span>
                <div><b style={{ fontWeight: 600 }}>{t as string}</b><div className="small muted">{d as string}</div></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="tiles">
        <div className="panel tile">
          <span className="label">Webcam</span>
          <span className="big"><span className={`dot ${cc === 'live' ? 'live' : cc}`} />{ct}</span>
          <span className="small muted">Processed on this device. Video is never uploaded or stored.</span>
        </div>
        <div className="panel tile">
          <span className="label">Audio system</span>
          <span className="big"><span className={`dot ${audio === 'running' ? 'ok' : audio === 'error' ? 'err' : 'warn'}`} />{audio === 'running' ? `Running · ${engine.ctx?.sampleRate ?? ''} Hz` : audio === 'error' ? 'Unavailable' : audio === 'suspended' ? 'Suspended' : 'Not started'}</span>
          {audio !== 'running' ? <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => engine.ensure()}>Enable audio</button>
            : <span className="small muted">Output latency ≈ {Math.round(engine.outputLatency * 1000)} ms</span>}
        </div>
        <div className="panel tile">
          <span className="label">Calibration</span>
          <span className="big"><span className={`dot ${calibrated ? 'ok' : 'warn'}`} />{calibrated ? 'Calibrated' : 'Not calibrated'}</span>
          <span className="small muted">Latency compensation {latency} ms · <a href="#/calibrate" onClick={(e) => { e.preventDefault(); nav('calibrate'); }}>{calibrated ? 'Recalibrate' : 'Calibrate now'}</a></span>
        </div>
        <div className="panel tile">
          <span className="label">Library</span>
          <span className="big">{recs?.length ?? 0} recordings</span>
          <span className="small muted"><a href="#/library" onClick={(e) => { e.preventDefault(); nav('library'); }}>Open music library</a></span>
        </div>
      </div>

      <div className="col" style={{ gap: 10 }}>
        <div className="row"><h2>Instruments</h2><span className="spacer" /><span className="small muted">Pick one to start playing</span></div>
        <div className="inst-grid">
          {INSTRUMENTS.map((i) => (
            <button key={i.id} className="inst-card" onClick={() => nav('instruments', i.id)}>
              <InstrumentGlyph id={i.id} />
              <b>{i.name}</b>
              <span className="small muted">{i.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      <Panel title="Recent recordings" bodyClass="" right={<button className="btn ghost sm" onClick={() => nav('library')}>View all</button>}>
        {!recs?.length ? <div className="empty">No recordings yet. Press Record on any instrument and your takes will appear here.</div> : (
          <table className="list">
            <tbody>
              {recs.slice(0, 5).map((r) => (
                <tr key={r.id}>
                  <td style={{ width: 44 }}>
                    <button className="btn sm icon" aria-label="Play" onClick={() => {
                      if (playing) { playing.a.pause(); URL.revokeObjectURL(playing.a.src); if (playing.id === r.id) { setPlaying(null); return; } }
                      const a = new Audio(URL.createObjectURL(r.wav));
                      a.onended = () => setPlaying(null);
                      a.play();
                      setPlaying({ id: r.id, a });
                    }}>{playing?.id === r.id ? Icon.stop : Icon.play}</button>
                  </td>
                  <td style={{ fontWeight: 550 }}>{r.name}</td>
                  <td><span className="tag">{INSTRUMENT_LABELS[r.instrument]}</span></td>
                  <td className="mono">{fmtTime(r.duration)}</td>
                  <td className="small muted">{fmtDate(r.createdAt)}</td>
                  <td className="mono small">{r.report?.overall !== null && r.report?.overall !== undefined ? `Score ${r.report.overall}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
