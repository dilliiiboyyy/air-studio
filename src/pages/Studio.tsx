import { useEffect, useMemo, useRef, useState } from 'react';
import { db, download, safeName, type Project, type Track, type Recording } from '../lib/db';
import { settings, useSettings, INSTRUMENT_LABELS, type InstrumentId } from '../lib/settings';
import { uid, fmtTime } from '../lib/music';
import { engine } from '../audio/engine';
import { transport } from '../audio/transport';
import { player, decodeTrack, mixdown } from '../audio/player';
import { renderEvents, quantize } from '../audio/render';
import { TakeRecorder } from '../audio/recorder';
import { audioBufferToWav } from '../lib/wav';
import { buildMidi } from '../lib/midi';
import { Stage } from '../ui/Stage';
import { BeatDots, BpmControl } from '../ui/TransportBar';
import { Icon, Panel, Select, Slider, Toggle, Modal } from '../ui/controls';
import { InstrumentPanel } from '../ui/InstrumentPanel';
import { useProjects, useRecordings, fmtDate } from '../ui/hooks';
import { INSTRUMENTS } from '../instruments';
import type { Nav } from '../App';

const NOTE_BASED = new Set<InstrumentId>(['piano', 'drums', 'percussion', 'guitar']);

function newProject(n: number): Project {
  const m = settings.get().metronome;
  return { id: uid(), name: `Project ${n}`, createdAt: Date.now(), updatedAt: Date.now(), bpm: m.bpm, sig: m.sig, master: 0.9, tracks: [] };
}

function trackFromRecording(r: Recording): Track {
  return {
    id: uid(), name: r.name, instrument: r.instrument, preset: r.preset, volume: 0.85, pan: 0, mute: false, solo: false,
    offsetMs: -settings.get().tracking.latencyMs, wav: r.wav, events: r.events, duration: r.duration,
  };
}

function Waveform({ track, scale, height }: { track: Track; scale: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    decodeTrack(track).then((b) => {
      const cv = ref.current;
      if (!alive || !cv) return;
      const w = Math.max(1, Math.round(b.duration * scale));
      const dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = w * dpr; cv.height = height * dpr;
      cv.style.width = `${w}px`;
      const g = cv.getContext('2d')!;
      g.scale(dpr, dpr);
      const d = b.getChannelData(0);
      const spp = d.length / w;
      g.fillStyle = 'rgba(214,138,72,0.12)';
      g.fillRect(0, 4, w, height - 8);
      g.fillStyle = '#C9844A';
      const mid = height / 2;
      for (let x = 0; x < w; x++) {
        let mx = 0;
        const s0 = Math.floor(x * spp), s1 = Math.min(d.length, Math.floor((x + 1) * spp));
        for (let i = s0; i < s1; i += 4) { const v = Math.abs(d[i]); if (v > mx) mx = v; }
        const hh = Math.max(0.5, Math.min(1, mx * 1.4) * (mid - 6));
        g.fillRect(x, mid - hh, 1, hh * 2);
      }
      // event ticks
      g.fillStyle = 'rgba(242,240,234,0.55)';
      for (const e of track.events) g.fillRect(e.t * scale, height - 6, 1, 4);
    }).catch(() => {});
    return () => { alive = false; };
  }, [track.wav, track.events, scale, height, track]);
  return <canvas ref={ref} style={{ position: 'absolute', left: `${(track.offsetMs / 1000) * scale}px`, top: 0, height }} />;
}

export function StudioPage({ nav, param }: { nav: Nav; param?: string }) {
  const projects = useProjects();
  const recordings = useRecordings();
  const [pid, setPid] = useState<string | null>(null);
  const [proj, setProj] = useState<Project | null>(null);
  const [playing, setPlaying] = useState(false);
  const [armedInst, setArmedInst] = useState<InstrumentId | null>(null);
  const [recState, setRecState] = useState<'idle' | 'rec' | 'saving'>('idle');
  const [clickOnRec, setClickOnRec] = useState(true);
  const [clickOnPlay, setClickOnPlay] = useState(false);
  const [busy, setBusy] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const recorder = useRef<TakeRecorder | null>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const [laneW, setLaneW] = useState(800);
  const handledParam = useRef(false);
  const metro = useSettings((s) => s.metronome);

  // pick / create project
  useEffect(() => {
    if (!projects || pid) return;
    if (projects.length) setPid(projects[0].id);
  }, [projects, pid]);
  useEffect(() => {
    if (!pid) { setProj(null); return; }
    db.getProject(pid).then((p) => setProj(p ?? null));
  }, [pid]);

  // "add:<recordingId>" route param from the library / take dialog
  useEffect(() => {
    if (handledParam.current || !param?.startsWith('add:') || !projects || !recordings) return;
    const rec = recordings.find((r) => r.id === param.slice(4));
    if (!rec) return;
    handledParam.current = true;
    (async () => {
      let p = projects[0] ?? newProject(1);
      p = { ...p, tracks: [...p.tracks, trackFromRecording(rec)], bpm: p.tracks.length ? p.bpm : rec.bpm ?? p.bpm, updatedAt: Date.now() };
      await db.putProject(p);
      setPid(p.id);
      setProj(p);
    })();
  }, [param, projects, recordings]);

  const save = async (p: Project) => { const np = { ...p, updatedAt: Date.now() }; setProj(np); await db.putProject(np); player.mix(np); };
  const updTrack = (id: string, patch: Partial<Track>) => proj && save({ ...proj, tracks: proj.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });

  const length = useMemo(() => {
    if (!proj) return 0;
    return Math.max(0, ...proj.tracks.map((t) => t.offsetMs / 1000 + t.duration));
  }, [proj]);
  const viewLen = Math.max(16, Math.ceil((length + 2) / 4) * 4);
  const scale = laneW / viewLen;

  useEffect(() => {
    const el = lanesRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLaneW(Math.max(200, el.clientWidth - 250)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [proj?.id]);

  // playhead
  useEffect(() => {
    let id = 0;
    const loop = () => {
      id = requestAnimationFrame(loop);
      let pos = player.position();
      const r = recorder.current;
      if (r && r.state === 'recording') pos = engine.now < r.startedAt ? 0 : r.elapsed();
      if (headRef.current) headRef.current.style.transform = `translateX(${250 + pos * scale}px)`;
      if (timeRef.current) {
        if (r && engine.now < r.startedAt) timeRef.current.textContent = 'count-in';
        else timeRef.current.textContent = fmtTime(pos);
      }
    };
    loop();
    return () => cancelAnimationFrame(id);
  }, [scale]);

  useEffect(() => { player.onEnd = () => { setPlaying(false); transport.stop(); }; return () => { player.stop(); player.onEnd = null; transport.stop(); recorder.current?.cancel(); }; }, []);

  const syncTempo = (p: Project) => settings.update('metronome', { bpm: p.bpm, sig: p.sig as typeof metro.sig });

  const play = async () => {
    if (!proj) return;
    if (playing) { player.stop(); transport.stop(); setPlaying(false); return; }
    await engine.ensure();
    syncTempo(proj);
    const from = player.position() >= length ? 0 : player.position();
    if (clickOnPlay && from === 0) {
      const zero = await transport.start(0, true);
      await player.play(proj, 0, zero);
    } else await player.play(proj, from);
    setPlaying(true);
  };

  const recordTrack = async () => {
    if (!proj || !armedInst) return;
    await engine.ensure();
    player.stop();
    syncTempo(proj);
    const zero = await transport.start(settings.get().metronome.countIn || 1, clickOnRec);
    // overdub: play existing tracks from bar 1 in sync with the new take
    if (proj.tracks.length) await player.play(proj, 0, zero, 3600);
    const r = new TakeRecorder();
    r.start(zero);
    recorder.current = r;
    setRecState('rec');
    setPlaying(true);
  };

  const stopRecording = async () => {
    const r = recorder.current;
    if (!r || !proj || !armedInst) return;
    setRecState('saving');
    const res = await r.stop();
    recorder.current = null;
    player.stop();
    transport.stop();
    setPlaying(false);
    const s = settings.get()[armedInst] as { preset?: string; pack?: string; layout?: string; volume: number };
    const n = proj.tracks.filter((t) => t.instrument === armedInst).length + 1;
    const t: Track = {
      id: uid(), name: `${INSTRUMENT_LABELS[armedInst].replace('Air ', '')} ${n}`, instrument: armedInst, preset: s.preset ?? s.pack ?? s.layout ?? '',
      volume: 0.85, pan: 0, mute: false, solo: false, offsetMs: -settings.get().tracking.latencyMs, wav: res.wav, events: res.events, duration: res.duration,
    };
    await save({ ...proj, tracks: [...proj.tracks, t] });
    player.stop();
    setRecState('idle');
  };

  const quantizeTrack = async (t: Track) => {
    if (!proj) return;
    setBusy(`Quantizing ${t.name}…`);
    try {
      const grid = 60 / proj.bpm / 4; // 16th notes
      const lat = settings.get().tracking.latencyMs / 1000;
      const evs = quantize(t.events, grid, lat);
      const fx = settings.get()[t.instrument].fx;
      const buf = await renderEvents(t.instrument, t.preset, evs, Math.max(t.duration, (evs[evs.length - 1]?.t ?? 0) + 1), engine.ctx!.sampleRate, fx);
      await updTrack(t.id, { wav: audioBufferToWav(buf), events: evs, offsetMs: 0, quantized: true, duration: buf.duration, name: t.name.endsWith('(Q)') ? t.name : `${t.name} (Q)` });
    } catch (e) { alert('Quantize failed: ' + e); }
    setBusy('');
  };

  const exportMix = async () => {
    if (!proj?.tracks.length) return;
    setBusy('Rendering mixdown…');
    try { download(audioBufferToWav(await mixdown(proj)), `${safeName(proj.name)}_mix.wav`); } catch (e) { alert('Mixdown failed: ' + e); }
    setBusy('');
  };

  const exportMidi = () => {
    if (!proj) return;
    const tr = proj.tracks.filter((t) => t.events.length).map((t) => ({ name: t.name, inst: t.instrument, preset: t.preset, events: t.events, offset: t.offsetMs / 1000 }));
    download(buildMidi(tr, proj.bpm), `${safeName(proj.name)}.mid`);
  };

  if (!projects) return <div className="page"><span className="muted">Loading…</span></div>;

  if (!proj) {
    return (
      <div className="page">
        <div className="page-head"><div><h1>Recording Studio</h1><p>Layer instruments on separate tracks: record a piano melody, then add drums, guitar and percussion over it. Each new take plays along with the tracks you already recorded.</p></div></div>
        <Panel title="Projects">
          <div className="empty col" style={{ alignItems: 'center' }}>
            <p>No projects yet.</p>
            <button className="btn primary" onClick={async () => { const p = newProject(1); await db.putProject(p); setPid(p.id); }}>{Icon.plus}New project</button>
          </div>
        </Panel>
      </div>
    );
  }

  const ticks: number[] = [];
  const barDur = (60 / proj.bpm) * transport.sig.beatsPerBar;
  for (let t = 0; t <= viewLen; t += barDur) ticks.push(t);

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <div className="label">Recording Studio · multitrack</div>
          <input className="name-input" style={{ fontSize: 22, fontWeight: 600, maxWidth: 420 }} value={proj.name} onChange={(e) => setProj({ ...proj, name: e.target.value })} onBlur={() => save(proj)} aria-label="Project name" />
        </div>
        <Select value={proj.id} onChange={(v) => { player.stop(); setPlaying(false); setPid(v); }} options={(projects ?? []).map((p) => ({ value: p.id, label: p.name }))} style={{ width: 180 }} />
        <button className="btn" onClick={async () => { const p = newProject((projects?.length ?? 0) + 1); await db.putProject(p); player.stop(); setPid(p.id); }}>{Icon.plus}New</button>
        <button className="btn danger" onClick={async () => { if (confirm(`Delete project "${proj.name}" and all its tracks?`)) { player.stop(); await db.deleteProject(proj.id); setPid(null); } }}>{Icon.trash}</button>
      </div>

      <div className="panel transport">
        <button className={`btn icon ${playing ? 'on' : ''}`} onClick={play} disabled={recState !== 'idle' || !proj.tracks.length} aria-label="Play or stop">{playing ? Icon.stop : Icon.play}</button>
        <button className="btn icon" onClick={() => { player.stop(); player.startPos = 0; setPlaying(false); transport.stop(); }} aria-label="Return to start" title="Return to start">⏮</button>
        <span className="timecode" ref={timeRef}>0:00</span>
        <BeatDots />
        <span className="sep" />
        <BpmControl />
        <button className="btn sm" onClick={() => save({ ...proj, bpm: metro.bpm, sig: metro.sig })} disabled={proj.bpm === metro.bpm && proj.sig === metro.sig}>Set {metro.bpm}</button>
        <span className="mono small" title="Project tempo">{proj.bpm} BPM · {proj.sig}</span>
        <span className="sep" />
        <Toggle label="Click on playback" value={clickOnPlay} onChange={setClickOnPlay} />
        <div style={{ width: 130 }}><Slider label="Master" value={proj.master} onChange={(v) => { const np = { ...proj, master: v }; setProj(np); player.mix(np); }} fmt={(v) => `${Math.round(v * 100)}`} /></div>
        <span className="spacer" />
        {busy && <span className="small muted">{busy}</span>}
        <button className="btn" onClick={exportMix} disabled={!proj.tracks.length}>{Icon.download}Mix WAV</button>
        <button className="btn" onClick={exportMidi} disabled={!proj.tracks.some((t) => t.events.length)}>{Icon.download}MIDI</button>
      </div>

      <section className="panel" ref={lanesRef} style={{ position: 'relative', overflow: 'hidden' }}>
        <div className="ruler" style={{ marginLeft: 250 }}>
          {ticks.map((t, i) => <span key={i} style={{ left: t * scale }}>{i + 1}</span>)}
          {ticks.map((t, i) => <i key={`t${i}`} style={{ left: t * scale }} />)}
        </div>
        <div className="playhead" ref={headRef} style={{ left: 0 }} />
        <div className="tracks">
          {proj.tracks.length === 0 && <div className="empty">No tracks yet. Choose an instrument below and record the first track, or add a take from your library.</div>}
          {proj.tracks.map((t) => (
            <div className="track" key={t.id}>
              <div className="track-head">
                <div className="row" style={{ gap: 6 }}>
                  <input className="name-input grow" value={t.name} onChange={(e) => setProj({ ...proj, tracks: proj.tracks.map((x) => (x.id === t.id ? { ...x, name: e.target.value } : x)) })} onBlur={() => save(proj)} aria-label="Track name" />
                  <button className={`ms m ${t.mute ? 'on' : ''}`} onClick={() => updTrack(t.id, { mute: !t.mute })} title="Mute">M</button>
                  <button className={`ms s ${t.solo ? 'on' : ''}`} onClick={() => updTrack(t.id, { solo: !t.solo })} title="Solo">S</button>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <span className="tag">{INSTRUMENT_LABELS[t.instrument].replace('Air ', '')}</span>
                  <input type="range" min={0} max={1} step={0.01} value={t.volume} title={`Volume ${Math.round(t.volume * 100)}`} aria-label="Track volume" style={{ ['--pct' as string]: `${t.volume * 100}%` }}
                    onChange={(e) => { const np = { ...proj, tracks: proj.tracks.map((x) => (x.id === t.id ? { ...x, volume: Number(e.target.value) } : x)) }; setProj(np); player.mix(np); }} onMouseUp={() => save(proj)} />
                  <input type="range" min={-1} max={1} step={0.05} value={t.pan} title={`Pan ${t.pan.toFixed(2)}`} aria-label="Track pan" style={{ width: 54, ['--pct' as string]: `${(t.pan + 1) * 50}%` }}
                    onChange={(e) => { const np = { ...proj, tracks: proj.tracks.map((x) => (x.id === t.id ? { ...x, pan: Number(e.target.value) } : x)) }; setProj(np); player.mix(np); }} onMouseUp={() => save(proj)} onDoubleClick={() => updTrack(t.id, { pan: 0 })} />
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn sm" onClick={() => updTrack(t.id, { offsetMs: t.offsetMs - 10 })} title="Nudge earlier 10 ms">◀</button>
                  <span className="mono tiny" style={{ minWidth: 54, textAlign: 'center' }} title="Track offset (timing alignment)">{t.offsetMs > 0 ? '+' : ''}{t.offsetMs} ms</span>
                  <button className="btn sm" onClick={() => updTrack(t.id, { offsetMs: t.offsetMs + 10 })} title="Nudge later 10 ms">▶</button>
                  <span className="spacer" />
                  {NOTE_BASED.has(t.instrument) && t.events.length > 0 && <button className="btn sm" onClick={() => quantizeTrack(t)} disabled={!!busy} title="Snap notes to the 16th-note grid and re-render the audio">Quantize</button>}
                  <button className="btn sm icon danger" onClick={() => { if (confirm(`Delete track "${t.name}"?`)) save({ ...proj, tracks: proj.tracks.filter((x) => x.id !== t.id) }); }} aria-label="Delete track">{Icon.trash}</button>
                </div>
              </div>
              <div className="track-lane" onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const pos = Math.max(0, (e.clientX - r.left) / scale);
                const was = playing;
                player.stop();
                player.startPos = pos;
                if (was) player.play(proj, pos);
              }}>
                {ticks.map((tt, i) => <div key={i} style={{ position: 'absolute', left: tt * scale, top: 0, bottom: 0, width: 1, background: '#2a2a2a' }} />)}
                <Waveform track={t} scale={scale} height={84} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="row">
        <span className="label">Add track</span>
        {INSTRUMENTS.map((i) => (
          <button key={i.id} className={`btn ${armedInst === i.id ? 'on' : ''}`} disabled={recState !== 'idle'} onClick={() => setArmedInst(armedInst === i.id ? null : i.id)}>{i.name.replace('Air ', '')}</button>
        ))}
        <span className="sep" />
        <button className="btn" onClick={() => setAddOpen(true)}>From library…</button>
      </div>

      {armedInst && (
        <div className="play-layout">
          <div className="col" style={{ gap: 10 }}>
            <div className="panel transport">
              <span className="small">Record a new <b>{INSTRUMENT_LABELS[armedInst]}</b> track{proj.tracks.length ? ' while the existing tracks play' : ''}.</span>
              <span className="spacer" />
              <Toggle label="Click" value={clickOnRec} onChange={setClickOnRec} />
              <Select value={metro.countIn} onChange={(v) => settings.update('metronome', { countIn: v })} options={[{ value: 1, label: '1-bar count-in' }, { value: 2, label: '2-bar count-in' }]} style={{ width: 140 }} />
              {recState === 'idle'
                ? <button className="btn rec-btn" onClick={recordTrack}><span className="rdot" />Record track</button>
                : <button className="btn rec-btn armed" onClick={stopRecording} disabled={recState === 'saving'}>{Icon.stop}{recState === 'saving' ? 'Saving…' : 'Stop'}</button>}
            </div>
            <Stage inst={armedInst} maxHeight="calc(100vh - 360px)" />
          </div>
          <InstrumentPanel inst={armedInst} />
        </div>
      )}

      {addOpen && (
        <Modal title="Add a take from the library" onClose={() => setAddOpen(false)}>
          {!recordings?.length ? <div className="empty">No recordings yet. Record takes from the Instruments page.</div> : (
            <table className="list">
              <thead><tr><th>Name</th><th>Instrument</th><th>Length</th><th>Date</th><th /></tr></thead>
              <tbody>{recordings.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td><td>{INSTRUMENT_LABELS[r.instrument]}</td><td className="mono">{fmtTime(r.duration)}</td><td className="small muted">{fmtDate(r.createdAt)}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn sm" onClick={() => { save({ ...proj, tracks: [...proj.tracks, trackFromRecording(r)] }); setAddOpen(false); }}>Add</button></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Modal>
      )}
      <p className="small faint">Timing alignment: new tracks are automatically shifted earlier by your measured camera latency ({settings.get().tracking.latencyMs} ms, set in Calibration). Nudge per track with ◀ ▶, or Quantize note-based tracks to the grid. <button className="btn ghost sm" onClick={() => nav('calibrate')}>Calibrate latency</button></p>
    </div>
  );
}
