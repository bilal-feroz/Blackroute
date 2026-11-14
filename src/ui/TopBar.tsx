import { Activity, Globe2, Map as MapIcon, RotateCcw, Sparkles } from 'lucide-react';
import type { AiStatus } from '../agents/run';
import type { TwinView } from '../scene/types';

export function TopBar({
  view,
  setView,
  ai,
  useAi,
  setUseAi,
  feedMode,
  logOpen,
  toggleLog,
  unread,
  onResetCamera,
}: {
  view: TwinView;
  setView: (v: TwinView) => void;
  ai: AiStatus | null;
  useAi: boolean;
  setUseAi: (v: boolean) => void;
  feedMode: 'live' | 'replay';
  logOpen: boolean;
  toggleLog: () => void;
  unread: number;
  onResetCamera: () => void;
}) {
  const aiOn = !!ai && useAi;
  return (
    <header className="topbar">
      <div className="brand">
        <svg className="brand-mark" viewBox="0 0 64 64" width="34" height="34" aria-hidden>
          <rect width="64" height="64" rx="16" fill="#15171a" />
          <path d="M14 44 L28 30 L36 38 L50 22" fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="28" cy="30" r="5" fill="#ea580c" stroke="#15171a" strokeWidth="2" />
        </svg>
        <div>
          <b>BlackRoute</b>
          <span>Find the weak routes before they go dark</span>
        </div>
      </div>

      <div className="seg" role="tablist" aria-label="View">
        <button className={view === 'local' ? 'on' : ''} onClick={() => setView('local')} role="tab" aria-selected={view === 'local'}>
          <MapIcon size={14} /> Dubai network
        </button>
        <button className={view === 'global' ? 'on' : ''} onClick={() => setView('global')} role="tab" aria-selected={view === 'global'}>
          <Globe2 size={14} /> Global lanes
        </button>
      </div>

      <div className="top-right">
        <span className={`pill ${feedMode === 'live' ? 'pill-live' : ''}`} title={feedMode === 'live' ? 'Signals from live news and weather' : 'Simulated signals for a demo'}>
          <span className="dot" />
          {feedMode === 'live' ? 'Live signals' : 'Replay'}
        </span>
        <button
          className={`pill pill-btn ${aiOn ? 'pill-ai' : ''}`}
          onClick={() => ai && setUseAi(!useAi)}
          title={ai ? `Click to ${useAi ? 'use rule-based agents' : 'use the AI model'}` : 'No AI key on the server: agents use rule-based reports'}
        >
          <Sparkles size={13} />
          {aiOn ? `AI on · ${ai!.model.split('/').pop()}` : ai ? 'AI paused' : 'AI offline · rules'}
        </button>
        <button className="icon-btn" onClick={onResetCamera} title="Reset the camera">
          <RotateCcw size={15} />
        </button>
        <button className={`icon-btn ${logOpen ? 'on' : ''}`} onClick={toggleLog} title="Agent activity">
          <Activity size={15} />
          {unread > 0 && !logOpen && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
        </button>
      </div>
    </header>
  );
}
