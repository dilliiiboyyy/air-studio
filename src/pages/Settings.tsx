import { useEffect, useState } from 'react';
import { settings, useSettings } from '../lib/settings';
import { db } from '../lib/db';
import { resetProgress } from '../practice/lessons';
import { Panel, Select, Slider, Toggle, Seg } from '../ui/controls';
import { tracker } from '../tracking/tracker';
import type { Nav } from '../App';

export function SettingsPage({ nav }: { nav: Nav }) {
  const t = useSettings((s) => s.tracking);
  const a = useSettings((s) => s.audio);
  const m = useSettings((s) => s.metronome);
  const b = useSettings((s) => s.backing);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [outs, setOuts] = useState<MediaDeviceInfo[]>([]);
  const sinkSupported = typeof (AudioContext.prototype as unknown as { setSinkId?: unknown }).setSinkId === 'function';

  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then((d) => {
      setCams(d.filter((x) => x.kind === 'videoinput'));
      setOuts(d.filter((x) => x.kind === 'audiooutput'));
    }).catch(() => {});
  }, []);

  const ut = (p: Partial<typeof t>) => settings.update('tracking', p);
  const ua = (p: Partial<typeof a>) => settings.update('audio', p);

  return (
    <div className="page">
      <div className="page-head"><div><h1>Settings</h1><p>The defaults work for most setups. Every setting is saved automatically in this browser.</p></div></div>
      <div className="grid2">
        <Panel title="Hand tracking">
          <div className="col" style={{ gap: 14 }}>
            <Select label="Camera" value={t.cameraId} onChange={(v) => { ut({ cameraId: v }); if (tracker.cameraActive) { tracker.stopCamera(); tracker.start(); } }}
              options={[{ value: '', label: 'Default (front camera)' }, ...cams.map((c, i) => ({ value: c.deviceId, label: c.label || `Camera ${i + 1}` }))]} />
            <Slider label="Tracking sensitivity" value={t.sensitivity} min={0} max={100} step={1} onChange={(v) => ut({ sensitivity: v })} hint="How fast a motion must be to count as a hit or strum" />
            <Slider label="Smoothing" value={t.smoothing} min={0} max={100} step={1} onChange={(v) => ut({ smoothing: v })} />
            <Slider label="Detection confidence" value={t.minConfidence} min={0.3} max={0.9} step={0.05} onChange={(v) => ut({ minConfidence: v })} hint="Applies after reloading the page" />
            <Slider label="Camera image brightness" value={t.videoOpacity} min={0} max={1} onChange={(v) => ut({ videoOpacity: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
            <Slider label="Latency compensation" value={t.latencyMs} min={0} max={300} step={5} onChange={(v) => ut({ latencyMs: v })} fmt={(v) => `${v} ms`} hint="Measured in Calibration. Used for lesson timing and multitrack alignment." />
            <Toggle label="Show hand skeleton" value={t.showLandmarks} onChange={(v) => ut({ showLandmarks: v })} />
            <Toggle label="Swap left/right hand labels" value={t.swapHands} onChange={(v) => ut({ swapHands: v })} />
            <div className="row"><button className="btn" onClick={() => nav('calibrate')}>Open calibration</button><button className="btn ghost" onClick={() => settings.reset('tracking')}>Reset tracking</button></div>
          </div>
        </Panel>
        <Panel title="Audio">
          <div className="col" style={{ gap: 14 }}>
            <Slider label="Master volume" value={a.master} onChange={(v) => ua({ master: v })} fmt={(v) => `${Math.round(v * 100)}`} />
            <Select label="Audio output" value={a.outputId} onChange={(v) => ua({ outputId: v })}
              options={[{ value: '', label: 'System default' }, ...outs.filter((o) => o.deviceId && o.deviceId !== 'default').map((o, i) => ({ value: o.deviceId, label: o.label || `Output ${i + 1}` }))]} />
            {!sinkSupported && <span className="tiny faint">This browser cannot choose an output device. The system default is used.</span>}
            <Seg label="Latency mode (applies after reload)" value={a.latencyHint} onChange={(v) => ua({ latencyHint: v })} options={[{ value: 'interactive', label: 'Lowest latency' }, { value: 'balanced', label: 'Balanced' }, { value: 'playback', label: 'Stable' }]} />
            <Toggle label="Output limiter (prevents clipping)" value={a.limiter} onChange={(v) => ua({ limiter: v })} />
            <span className="label" style={{ marginTop: 6 }}>Metronome & backing</span>
            <Slider label="Metronome volume" value={m.volume} onChange={(v) => settings.update('metronome', { volume: v })} fmt={(v) => `${Math.round(v * 100)}`} />
            <Select label="Count-in before recording" value={m.countIn} onChange={(v) => settings.update('metronome', { countIn: v })} options={[{ value: 0, label: 'None' }, { value: 1, label: '1 bar' }, { value: 2, label: '2 bars' }]} />
            <Toggle label="Accent the first beat" value={m.accent} onChange={(v) => settings.update('metronome', { accent: v })} />
            <Slider label="Backing track volume" value={b.volume} onChange={(v) => settings.update('backing', { volume: v })} fmt={(v) => `${Math.round(v * 100)}`} />
            <Toggle label="Loop backing track" value={b.loop} onChange={(v) => settings.update('backing', { loop: v })} />
            <Toggle label="Include backing track in recordings" value={b.includeInRecording} onChange={(v) => settings.update('backing', { includeInRecording: v })} />
          </div>
        </Panel>
        <Panel title="Privacy">
          <ul className="recs small">
            <li>The camera is requested only when you start an instrument, practice or calibration, and it switches off when you leave those screens. A red “Camera on” badge shows whenever it is active.</li>
            <li>Hand tracking (MediaPipe) runs entirely in your browser. The model and runtime are served by this app, and no video frames are sent anywhere.</li>
            <li>Camera footage is never recorded or stored. Only the audio you play and the note timing are saved.</li>
            <li>Recordings and projects are stored locally (IndexedDB) and stay on this device until you delete them.</li>
          </ul>
        </Panel>
        <Panel title="Data">
          <div className="col" style={{ gap: 12 }}>
            <div className="row"><button className="btn danger" onClick={async () => { if (confirm('Delete ALL recordings and projects? This cannot be undone.')) await db.clearAll(); }}>Delete all recordings & projects</button></div>
            <div className="row"><button className="btn danger" onClick={() => { if (confirm('Reset lesson progress?')) resetProgress(); }}>Reset lesson progress</button></div>
            <div className="row"><button className="btn" onClick={() => { if (confirm('Restore all settings to defaults?')) settings.reset(); }}>Restore default settings</button></div>
            <p className="tiny faint">Sample credits: Salamander Grand Piano V3 by Alexander Holm (CC BY 3.0). Guitar and bass samples from tonejs-instruments (MIT). TR-808 samples via @fluid-music/tr-808 (ISC). Hand tracking by Google MediaPipe (Apache 2.0).</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
