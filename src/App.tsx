import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityFeed } from './ui/ActivityFeed';
import { MissionPanel } from './ui/MissionPanel';
import { Legend, NodeCard } from './ui/NodeCard';
import { Timeline } from './ui/Timeline';
import { TopBar } from './ui/TopBar';
import { TwinView, resetTwinCamera } from './ui/TwinView';
import { activeRun, useMission, type Stage } from './ui/useMission';
import type { Phase, TwinState, TwinView as View } from './scene/types';
import './styles/twin.css';
import './styles/ui.css';

const PHASE: Record<Stage, Phase> = {
  watch: 'watch',
  investigate: 'incident',
  plan: 'plan',
  decide: 'plan',
  recover: 'recovery',
};

export default function App() {
  const [view, setView] = useState<View>('local');
  const [hour, setHour] = useState(6);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(3);
  const [logOpen, setLogOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  const [compare, setCompare] = useState<'plan' | 'nothing'>('plan');
  const [focus, setFocus] = useState<string | null>(null);
  const insets = useInsets();

  const restart = useCallback((h: number) => {
    setHour(h);
    setPlaying(true);
  }, []);
  const a = useMission(restart);
  const { m } = a;
  const run = activeRun(m, compare);

  // jump to the global view when the trouble is out at sea
  const lastScenario = useRef<string | null>(null);
  useEffect(() => {
    if (m.stage === 'investigate' && m.scenario && m.scenario.id !== lastScenario.current) {
      lastScenario.current = m.scenario.id;
      setView(m.scenario.place === 'global' ? 'global' : 'local');
    }
    if (m.stage === 'watch') lastScenario.current = null;
  }, [m.stage, m.scenario]);

  // playback clock: the twin replays simulator hours
  const stageRef = useRef(m.stage);
  stageRef.current = m.stage;
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      setHour((h) => {
        const next = h + dt * speed * 1.6;
        if (next < run.horizonHours - 1) return next;
        if (stageRef.current === 'watch') return 0; // calm weeks loop
        setPlaying(false);
        return run.horizonHours - 1;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, run.horizonHours]);

  useEffect(() => {
    if (logOpen) setSeen(m.log.length);
  }, [logOpen, m.log.length]);

  const twinState: TwinState = useMemo(
    () => ({
      view,
      run,
      hour,
      scenario: m.stage === 'watch' ? null : m.scenario,
      levers: run.options.levers ?? [],
      phase: PHASE[m.stage],
      blackRoutes: m.radar,
      focus,
    }),
    [view, run, hour, m.stage, m.scenario, m.radar, focus],
  );

  const label =
    m.stage === 'watch'
      ? 'A normal three weeks'
      : m.stage === 'recover' && compare === 'plan'
        ? 'With the approved plan'
        : 'If we do nothing';

  return (
    <div className="app">
      <TwinView state={twinState} onPick={setFocus} insets={insets} />
      <TopBar
        view={view}
        setView={setView}
        ai={m.ai}
        useAi={m.useAi}
        setUseAi={a.setUseAi}
        feedMode={m.feedMode}
        logOpen={logOpen}
        toggleLog={() => setLogOpen((o) => !o)}
        unread={m.log.length - seen}
        onResetCamera={resetTwinCamera}
      />
      <ActivityFeed log={m.log} open={logOpen} onClose={() => setLogOpen(false)} />
      <MissionPanel a={a} compare={compare} setCompare={setCompare} onReplay={() => restart(Math.max(0, (m.disruption?.startHour ?? 0) - 4))} />
      {focus && <NodeCard id={focus} run={run} hour={hour} onClose={() => setFocus(null)} />}
      <Legend />
      <Timeline run={run} hour={hour} setHour={setHour} playing={playing} setPlaying={setPlaying} speed={speed} setSpeed={setSpeed} label={label} />
    </div>
  );
}

/** Room the glass panels take, so the 3D board is framed beside them. */
function useInsets() {
  const calc = () => {
    const w = window.innerWidth;
    if (w <= 760) return { top: 110, right: 0, bottom: Math.round(window.innerHeight * 0.46) + 90, left: 0 };
    return { top: 70, right: w <= 980 ? 388 : 432, bottom: 86, left: 0 };
  };
  const [insets, setInsets] = useState(calc);
  useEffect(() => {
    const on = () => setInsets(calc());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return insets;
}
