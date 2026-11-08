import { useEffect, useMemo, useRef, useState } from 'react';
import { simulate } from './core/engine';
import { SCENARIOS, SCENARIO_BY_ID, toDisruption } from './core/scenarios';
import { Twin } from './scene/Twin';
import { EMPTY_STATE } from './scene/types';
import './styles/twin.css';

// Temporary harness to look at the 3D twin while it is being built.
export default function App() {
  const host = useRef<HTMLDivElement>(null);
  const twin = useRef<Twin | null>(null);
  const q = new URLSearchParams(location.search);
  const [hour, setHour] = useState(Number(q.get('h') ?? 20));
  const [play, setPlay] = useState(q.get('play') !== '0');
  const [sc, setSc] = useState<string>(q.get('sc') ?? '');
  const [lev, setLev] = useState(q.get('lev') === '1');
  const [view, setView] = useState<'local' | 'global'>(q.get('view') === 'global' ? 'global' : 'local');
  const scenario = sc ? SCENARIO_BY_ID[sc] : null;
  const run = useMemo(
    () => simulate({ disruption: scenario ? toDisruption(scenario) : null, levers: lev && scenario ? scenario.levers.slice(0, 2) : [], record: true }),
    [scenario, lev],
  );

  useEffect(() => {
    const t = new Twin(host.current!);
    twin.current = t;
    t.init();
    return () => t.dispose();
  }, []);

  useEffect(() => {
    if (!play) return;
    const id = setInterval(() => setHour((h) => (h + 0.05) % run.horizonHours), 30);
    return () => clearInterval(id);
  }, [play, run]);

  useEffect(() => {
    twin.current?.setState({ ...EMPTY_STATE, view, run, hour, scenario, levers: run.options.levers ?? [], phase: scenario ? 'incident' : 'watch' });
  }, [run, hour, scenario, view]);

  return (
    <main style={{ position: 'relative', height: '100%' }}>
      <div className="twin" ref={host} />
      <div style={{ position: 'absolute', left: 12, top: 12, display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
        <button onClick={() => setPlay((p) => !p)}>{play ? 'pause' : 'play'}</button>
        <span>
          day {Math.floor(hour / 24) + 1} {String(Math.floor(hour % 24)).padStart(2, '0')}:00
        </span>
        <select value={sc} onChange={(e) => setSc(e.target.value)}>
          <option value="">normal</option>
          {SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={lev} onChange={(e) => setLev(e.target.checked)} /> levers
        </label>
        <button onClick={() => setView(view === 'local' ? 'global' : 'local')}>{view}</button>
        <span>svc {(run.metrics.serviceLevel * 100).toFixed(1)}%</span>
      </div>
    </main>
  );
}
