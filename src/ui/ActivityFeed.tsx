import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { AGENT_META, AgentChip } from './bits';
import type { LogEntry } from './useMission';

const KIND_LABEL: Record<LogEntry['kind'], string> = {
  start: 'started',
  tool: 'tool call',
  output: 'report',
  handoff: 'hand-off',
  note: 'note',
  warn: 'warning',
};

export function ActivityFeed({ log, open, onClose }: { log: LogEntry[]; open: boolean; onClose: () => void }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log.length, open]);

  return (
    <aside className={`activity ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="activity-head">
        <div>
          <b>Agent activity</b>
          <span>Every step, tool call and hand-off</span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={15} />
        </button>
      </div>
      <div className="activity-list scroll">
        {log.map((e) => (
          <div key={e.id} className={`log log-${e.kind}`}>
            <AgentChip agent={e.agent} size={22} />
            <div className="log-body">
              <div className="log-top">
                <b style={{ color: AGENT_META[e.agent].color }}>{AGENT_META[e.agent].name}</b>
                <span className="log-kind">{KIND_LABEL[e.kind]}</span>
                <span className="log-time">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              </div>
              <div className={e.kind === 'tool' ? 'log-text mono' : 'log-text'}>{e.text}</div>
              {e.detail && <div className="log-detail">{e.detail}</div>}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
    </aside>
  );
}
