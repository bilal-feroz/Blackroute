// Small shared pieces of the BlackRoute interface.
import { useState, type ReactNode } from 'react';
import { BrainCircuit, CheckCircle2, Cpu, Radar, Send, ShieldAlert, ThumbsDown, ThumbsUp, TriangleAlert, User, Waypoints } from 'lucide-react';
import type { AgentReport } from '../agents/run';
import type { LogEntry } from './useMission';

export const AGENT_META: Record<LogEntry['agent'], { name: string; color: string; Icon: typeof Radar; role: string }> = {
  sentinel: { name: 'Sentinel', color: 'var(--teal)', Icon: Radar, role: 'watches signals' },
  tracer: { name: 'Tracer', color: 'var(--cyan)', Icon: Waypoints, role: 'traces the impact' },
  strategist: { name: 'Strategist', color: 'var(--green)', Icon: BrainCircuit, role: 'tests recovery plans' },
  redteam: { name: 'Red Team', color: 'var(--red)', Icon: ShieldAlert, role: 'tries to break the plan' },
  dispatcher: { name: 'Dispatcher', color: 'var(--amber)', Icon: Send, role: 'drafts the actions' },
  human: { name: 'You', color: 'var(--ink)', Icon: User, role: 'decides' },
  system: { name: 'BlackRoute', color: 'var(--text-3)', Icon: Cpu, role: 'simulator' },
};

export function AgentChip({ agent, size = 26 }: { agent: LogEntry['agent']; size?: number }) {
  const a = AGENT_META[agent];
  return (
    <span className="agent-chip" style={{ width: size, height: size, color: a.color, borderColor: a.color }} title={`${a.name}: ${a.role}`}>
      <a.Icon size={size * 0.55} strokeWidth={2} />
    </span>
  );
}

export function AgentHeader({ agent, report, busy }: { agent: Exclude<LogEntry['agent'], 'human' | 'system'>; report?: AgentReport | null; busy?: boolean }) {
  const a = AGENT_META[agent];
  return (
    <div className="agent-head">
      <AgentChip agent={agent} />
      <div className="agent-head-text">
        <b>{a.name}</b>
        <span>{a.role}</span>
      </div>
      {busy && <span className="pulse-dot" />}
      {report && <SourceTag report={report} />}
      {report && <Feedback agent={agent} report={report} />}
    </div>
  );
}

// ---------------------------------------------------------------- feedback
const FEEDBACK_KEY = 'blackroute-feedback';
type Vote = { agent: string; source: string; model?: string; vote: 'up' | 'down'; headline: string; at: string };

function readVotes(): Vote[] {
  try {
    return JSON.parse(localStorage.getItem(FEEDBACK_KEY) ?? '[]') as Vote[];
  } catch {
    return [];
  }
}

/** Thumbs up or down on a report, kept in this browser to review which agent answers help. */
function Feedback({ agent, report }: { agent: string; report: AgentReport }) {
  const headline = (report.out as { headline?: string; brief?: string; summary?: string }).headline ?? (report.out as { brief?: string }).brief ?? '';
  const [vote, setVote] = useState<'up' | 'down' | null>(() => readVotes().find((v) => v.agent === agent && v.headline === headline)?.vote ?? null);
  const cast = (v: 'up' | 'down') => {
    setVote(v);
    try {
      const rest = readVotes().filter((x) => !(x.agent === agent && x.headline === headline));
      rest.push({ agent, source: report.source, model: report.model, vote: v, headline, at: new Date().toISOString() });
      localStorage.setItem(FEEDBACK_KEY, JSON.stringify(rest.slice(-200)));
    } catch {
      /* storage blocked: the vote still shows for this session */
    }
  };
  return (
    <span className="feedback" role="group" aria-label="Was this report useful?">
      <button className={vote === 'up' ? 'on' : ''} onClick={() => cast('up')} aria-pressed={vote === 'up'} title="Useful">
        <ThumbsUp size={13} />
      </button>
      <button className={vote === 'down' ? 'on down' : ''} onClick={() => cast('down')} aria-pressed={vote === 'down'} title="Not useful">
        <ThumbsDown size={13} />
      </button>
    </span>
  );
}

/** Shows whether the text came from the model or the rules, and whether its numbers are grounded. */
export function SourceTag({ report }: { report: AgentReport }) {
  const g = report.grounding;
  return (
    <span className={`source-tag ${g.ok ? 'ok' : 'warn'}`} title={g.ok ? `All ${g.checked} numbers traced to the simulator` : `Not found in the simulator results: ${g.unsupported.join(', ')}`}>
      {g.ok ? <CheckCircle2 size={12} /> : <TriangleAlert size={12} />}
      {report.source === 'ai' ? 'AI' : 'Rules'}
      {' · '}
      {g.ok ? 'grounded' : `${g.unsupported.length} unverified`}
    </span>
  );
}

export function Metric({ label, value, tone, sub }: { label: string; value: ReactNode; tone?: 'good' | 'warn' | 'bad' | 'neutral'; sub?: ReactNode }) {
  return (
    <div className={`metric ${tone ?? 'neutral'}`}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
      {sub && <span className="metric-sub">{sub}</span>}
    </div>
  );
}

export function Bar({ value, tone = 'teal' }: { value: number; tone?: 'teal' | 'amber' | 'red' | 'green' | 'violet' }) {
  return (
    <span className={`bar bar-${tone}`}>
      <span style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    </span>
  );
}

export function Card({ children, className = '', tone }: { children: ReactNode; className?: string; tone?: 'alert' | 'good' | 'warn' }) {
  return <section className={`card ${tone ? `card-${tone}` : ''} ${className}`}>{children}</section>;
}

export function Button({
  children,
  onClick,
  kind = 'primary',
  disabled,
  icon,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'ghost' | 'danger' | 'good';
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button className={`btn btn-${kind}`} onClick={onClick} disabled={disabled}>
      {icon}
      <span>{children}</span>
    </button>
  );
}
