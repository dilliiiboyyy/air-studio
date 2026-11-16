import { useEffect, useRef, useState } from 'react';
import { settings, useSettings } from '../lib/settings';
import { transport, TEMPO_PRESETS } from '../audio/transport';
import { backing, BACKING_STYLES } from '../audio/backing';
import { engine } from '../audio/engine';
import { TakeRecorder, type TakeResult } from '../audio/recorder';
import { fmtTime } from '../lib/music';
import { Icon, Select, Toggle } from './controls';
import { useTransportState } from './hooks';

export interface TakeMeta { bpm: number; sig: string; gridDefined: boolean; backing?: string }

/** Beat indicator boxes driven directly from the audio clock (no React re-render per beat). */
export function BeatDots() {
  const ref = useRef<HTMLDivElement>(null);
  const { sig, running } = useTransportState();
  const n = transport.sig.beatsPerBar;
  useEffect(() => {
    let id = 0;
    const loop = () => {
      id = requestAnimationFrame(loop);
      const el = ref.current;
      if (!el) return;
      const kids = el.children;
      if (!transport.running) { for (const k of kids) k.className = ''; return; }
      const p = transport.position(engine.now - engine.outputLatency);
      for (let i = 0; i < kids.length; i++) {
        const on = i === p.beatInBar && p.frac < 0.35;
        kids[i].className = `${on ? 'on' : ''} ${transport.sig.accents.includes(i) ? 'acc' : ''} ${p.countIn ? 'ci' : ''}`;
      }
    };
    loop();
    return () => cancelAnimationFrame(id);
  }, [sig, running]);
  return <div className="beats" ref={ref} aria-label="Beat indicator">{Array.from({ length: n }, (_, i) => <i key={i} />)}</div>;
}

export function BpmControl() {
  const bpm = useSettings((s) => s.metronome.bpm);
  const taps = useRef<number[]>([]);
  const set = (v: number) => settings.update('metronome', { bpm: Math.max(30, Math.min(260, Math.round(v))) });
  return (
    <div className="row" style={{ gap: 6 }}>
      <div className="bpm" title="Tempo (BPM)">
        <button onClick={() => set(bpm - 1)} aria-label="Slower">−</button>
        <input type="number" value={bpm} onChange={(e) => set(Number(e.target.value) || bpm)} aria-label="BPM" />
        <button onClick={() => set(bpm + 1)} aria-label="Faster">+</button>
      </div>
      <span className="tiny muted">BPM</span>
      <button className="btn sm" title="Tap tempo" onClick={() => {
        const now = performance.now();
        taps.current = [...taps.current.filter((t) => now - t < 2500), now].slice(-6);
        if (taps.current.length >= 3) {
          const iv = taps.current.slice(1).map((t, i) => t - taps.current[i]);
          set(60000 / (iv.reduce((a, b) => a + b, 0) / iv.length));
        }
      }}>Tap</button>
    </div>
  );
}

interface Props { recordable?: boolean; onTake?: (r: TakeResult, meta: TakeMeta) => void; disabled?: boolean; compact?: boolean }

export function TransportBar({ recordable, onTake, disabled }: Props) {
  const m = useSettings((s) => s.metronome);
  const b = useSettings((s) => s.backing);
  const ts = useTransportState();
  const [clickOn, setClickOn] = useState(true);
  const [backOn, setBackOn] = useState(false);
  const [rec, setRec] = useState<'idle' | 'countin' | 'rec' | 'paused' | 'saving'>('idle');
  const recorder = useRef<TakeRecorder | null>(null);
  const startedByRec = useRef(false);
  const meta = useRef<TakeMeta>({ bpm: 0, sig: '', gridDefined: false });
  const timeRef = useRef<HTMLSpanElement>(null);
  const [err, setErr] = useState('');

  useEffect(() => { transport.clickOn = clickOn; }, [clickOn]);

  // time / count-in display
  useEffect(() => {
    let id = 0;
    const loop = () => {
      id = requestAnimationFrame(loop);
      const r = recorder.current;
      if (!timeRef.current) return;
      if (r && (r.state === 'recording' || r.state === 'paused')) {
        if (engine.now < r.startedAt) {
          const p = transport.position(engine.now);
          timeRef.current.textContent = `-${transport.sig.beatsPerBar - p.beatInBar}`;
        } else {
          timeRef.current.textContent = fmtTime(r.elapsed());
          if (rec === 'countin') setRec('rec');
        }
      } else if (transport.running) {
        const p = transport.position(engine.now);
        timeRef.current.textContent = p.countIn ? 'count' : `${p.bar + 1}.${p.beatInBar + 1}`;
      } else timeRef.current.textContent = '0:00';
    };
    loop();
    return () => cancelAnimationFrame(id);
  }, [rec]);

  useEffect(() => () => { recorder.current?.cancel(); backing.detach(); transport.stop(); }, []);

  const play = async () => {
    await engine.ensure();
    if (transport.running) {
      transport.stop();
      backing.detach();
      return;
    }
    if (backOn) await backing.attach();
    await transport.start(0, clickOn);
  };

  const record = async () => {
    setErr('');
    try {
      await engine.ensure();
      if (!engine.capture) throw new Error('Recording is not supported in this browser (AudioWorklet unavailable).');
      let zero: number;
      const gridDefined = clickOn || backOn;
      if (!transport.running) {
        startedByRec.current = true;
        if (backOn) await backing.attach();
        const countIn = m.countIn;
        zero = await transport.start(countIn, clickOn);
        if (!countIn && !gridDefined) zero = engine.now + 0.03;
      } else {
        startedByRec.current = false;
        const cur = transport.stepAt(engine.now + 0.05);
        const nextBar = Math.ceil(cur / transport.stepsPerBar) * transport.stepsPerBar;
        zero = transport.stepTime(nextBar);
      }
      meta.current = { bpm: transport.bpm, sig: transport.sigName, gridDefined, backing: backOn ? backing.style.id : undefined };
      const r = new TakeRecorder();
      r.start(zero);
      recorder.current = r;
      setRec('countin');
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      setRec('idle');
    }
  };

  const stop = async () => {
    const r = recorder.current;
    if (!r) return;
    setRec('saving');
    const res = await r.stop();
    recorder.current = null;
    if (startedByRec.current) { transport.stop(); backing.detach(); }
    setRec('idle');
    onTake?.(res, meta.current);
  };

  const recording = rec === 'rec' || rec === 'countin' || rec === 'paused';

  return (
    <div className="panel transport">
      <button className={`btn icon ${ts.running ? 'on' : ''}`} onClick={play} disabled={disabled || recording} title={ts.running ? 'Stop metronome/backing' : 'Play metronome/backing'} aria-label="Play or stop transport">
        {ts.running ? Icon.stop : Icon.play}
      </button>
      <BeatDots />
      <span className="timecode" ref={timeRef}>0:00</span>
      <span className="sep" />
      <BpmControl />
      <Select value={m.sig} onChange={(v) => settings.update('metronome', { sig: v })} options={['4/4', '3/4', '6/8', '2/4', '5/4'].map((x) => ({ value: x as typeof m.sig, label: x }))} style={{ width: 70 }} />
      <Select value={0} onChange={(v) => { if (v) settings.update('metronome', { bpm: v }); }} options={[{ value: 0, label: 'Tempo presets' }, ...TEMPO_PRESETS.map((t) => ({ value: t.bpm, label: `${t.label} · ${t.bpm}` }))]} style={{ width: 140 }} />
      <Toggle label="Click" value={clickOn} onChange={setClickOn} />
      <span className="sep" />
      <Toggle label="Backing" value={backOn} onChange={(v) => { setBackOn(v); if (!v) backing.detach(); else if (transport.running) backing.attach(); }} />
      <Select value={b.style} onChange={(v) => backing.select(v)} options={BACKING_STYLES.map((s) => ({ value: s.id, label: `${s.genre} · ${s.label}` }))} style={{ width: 190 }} />
      {recordable && (
        <>
          <span className="spacer" />
          {err && <span className="small" style={{ color: 'var(--red)' }}>{err}</span>}
          {!recording ? (
            <button className="btn rec-btn" onClick={record} disabled={disabled || rec === 'saving'} title={m.countIn ? `Record with ${m.countIn}-bar count-in` : 'Record'}>
              <span className="rdot" />{rec === 'saving' ? 'Saving…' : 'Record'}
            </button>
          ) : (
            <>
              <span className="row small" style={{ gap: 6, color: rec === 'countin' ? 'var(--amber)' : 'var(--red)' }}>
                <span className={`dot ${rec === 'rec' ? 'rec' : rec === 'countin' ? 'warn' : ''}`} />{rec === 'countin' ? 'Count-in' : rec === 'paused' ? 'Paused' : 'Recording'}
              </span>
              {rec === 'paused'
                ? <button className="btn" onClick={() => { recorder.current?.resume(); setRec('rec'); }}>{Icon.play}Resume</button>
                : <button className="btn" onClick={() => { recorder.current?.pause(); setRec('paused'); }} disabled={rec === 'countin'}>{Icon.pause}Pause</button>}
              <button className="btn rec-btn armed" onClick={stop}>{Icon.stop}Stop</button>
            </>
          )}
        </>
      )}
    </div>
  );
}
