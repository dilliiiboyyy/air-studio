import { useEffect, useState, type ReactNode } from 'react';
import type { InstrumentId } from './lib/settings';
import { Icon } from './ui/controls';
import { useAudioStatus, useTrackerStatus } from './ui/hooks';
import { engine } from './audio/engine';
import { HomePage } from './pages/Home';
import { InstrumentsPage } from './pages/Instruments';
import { PracticePage } from './pages/Practice';
import { StudioPage } from './pages/Studio';
import { LibraryPage } from './pages/Library';
import { SettingsPage } from './pages/Settings';
import { CalibrationPage } from './pages/Calibration';

export type Route = 'home' | 'instruments' | 'practice' | 'studio' | 'library' | 'settings' | 'calibrate';
export type Nav = (r: Route, param?: string) => void;

const INST_IDS = ['piano', 'drums', 'guitar', 'synth', 'percussion'];

function parseHash(): { route: Route; param?: string } {
  const [, r, p] = location.hash.split('/');
  const route = (['home', 'instruments', 'practice', 'studio', 'library', 'settings', 'calibrate'].includes(r) ? r : 'home') as Route;
  return { route, param: p ? decodeURIComponent(p) : undefined };
}

const NAV: { id: Route; label: string; icon: ReactNode }[] = [
  { id: 'home', label: 'Home', icon: Icon.home },
  { id: 'instruments', label: 'Instruments', icon: Icon.inst },
  { id: 'practice', label: 'Practice', icon: Icon.practice },
  { id: 'studio', label: 'Recording Studio', icon: Icon.studio },
  { id: 'library', label: 'Music Library', icon: Icon.library },
  { id: 'settings', label: 'Settings', icon: Icon.settings },
];

export default function App() {
  const [{ route, param }, setLoc] = useState(parseHash);
  const cam = useTrackerStatus();
  const audio = useAudioStatus();
  const [lastInst, setLastInst] = useState<InstrumentId>('piano');

  useEffect(() => {
    const on = () => setLoc(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const nav: Nav = (r, p) => {
    if (r === 'instruments' && p && INST_IDS.includes(p)) setLastInst(p as InstrumentId);
    const ip = r === 'instruments' && !p ? lastInst : p;
    location.hash = `/${r}${ip ? `/${encodeURIComponent(ip)}` : ''}`;
  };

  const inst = (route === 'instruments' && param && INST_IDS.includes(param) ? param : lastInst) as InstrumentId;
  const camLive = cam === 'running';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><i /></span><span>AIR STUDIO</span></div>
        <span className="spacer" />
        <span className="status-chip" title="Webcam status">
          <span className={`dot ${camLive ? 'live' : cam === 'sim' || cam === 'loading' || cam === 'starting' ? 'warn' : ['denied', 'nocamera', 'error', 'inuse'].includes(cam) ? 'err' : ''}`} />
          {camLive ? 'Camera on' : cam === 'sim' ? 'Simulated hands' : cam === 'loading' ? 'Loading tracker' : cam === 'starting' ? 'Starting camera' : ['denied', 'nocamera', 'error', 'inuse'].includes(cam) ? 'Camera unavailable' : 'Camera off'}
        </span>
        <button className="status-chip" title="Audio status" onClick={() => engine.ensure()}>
          <span className={`dot ${audio === 'running' ? 'ok' : audio === 'error' ? 'err' : 'warn'}`} />
          {audio === 'running' ? 'Audio ready' : audio === 'error' ? 'Audio error' : 'Click to enable audio'}
        </button>
        <button className="status-chip opt" onClick={() => nav('calibrate')}>{Icon.calib && <span style={{ width: 14, height: 14, display: 'inline-flex' }}>{Icon.calib}</span>}Calibrate</button>
      </header>
      <nav className="sidebar" aria-label="Main">
        {NAV.map((n) => (
          <button key={n.id} className={`nav-item ${route === n.id ? 'active' : ''}`} onClick={() => nav(n.id)} title={n.label}>
            {n.icon}<span>{n.label}</span>
          </button>
        ))}
        <div className="sidebar-foot">
          Hand tracking runs locally. Nothing you play or film leaves this device.
        </div>
      </nav>
      <main className="main">
        {route === 'home' && <HomePage nav={nav} />}
        {route === 'instruments' && <InstrumentsPage inst={inst} nav={nav} />}
        {route === 'practice' && <PracticePage nav={nav} initial={param} />}
        {route === 'studio' && <StudioPage nav={nav} param={param} />}
        {route === 'library' && <LibraryPage nav={nav} />}
        {route === 'settings' && <SettingsPage nav={nav} />}
        {route === 'calibrate' && <CalibrationPage nav={nav} />}
      </main>
    </div>
  );
}
