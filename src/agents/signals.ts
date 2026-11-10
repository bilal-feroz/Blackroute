// Signals the Sentinel agent reads, and the deterministic matcher it uses as
// a tool before the model makes its judgement.

import { SCENARIOS } from '../core/scenarios';

export interface Signal {
  id: string;
  kind: 'news' | 'weather' | 'replay';
  title: string;
  source: string;
  url?: string;
  publishedAt: string;
}

export interface WeatherSummary {
  maxGustKmh: number;
  minVisibilityM: number;
  maxDust: number;
  hazard: boolean;
}

export interface SignalFeed {
  fetchedAt: string;
  signals: Signal[];
  weather: WeatherSummary | null;
  errors: string[];
  mode: 'live' | 'replay';
}

export interface Match {
  scenarioId: string;
  score: number;
  signalIds: string[];
}

// Headlines that talk to the AI instead of reporting news (prompt injection).
const INJECTION = [
  /\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(rules?|instructions?|prompts?|guidelines)\b/i,
  /\b(system prompt|you are now|pretend to be|new instructions)\b/i,
];

/** True when a headline reads like an instruction to the model, not news. */
export function isSuspicious(title: string): boolean {
  return INJECTION.some((r) => r.test(title));
}

/** Keyword match of signals to known scenarios: the Sentinel's first tool. */
export function matchSignals(signals: Signal[]): Match[] {
  const out: Match[] = [];
  const clean = signals.filter((s) => !isSuspicious(s.title));
  for (const s of SCENARIOS) {
    const ids: string[] = [];
    let score = 0;
    for (const sig of clean) {
      const t = sig.title.toLowerCase();
      const hits = s.keywords.filter((k) => t.includes(k)).length;
      if (hits) {
        ids.push(sig.id);
        score += hits + (sig.kind === 'weather' ? 2 : 0);
      }
    }
    if (score) out.push({ scenarioId: s.id, score, signalIds: ids.slice(0, 6) });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Replay signals for a reliable demo. They are written as simulated alerts
 * from BlackRoute itself, never as articles from real news outlets.
 */
const REPLAY: Record<string, string[]> = {
  hormuz_closure: [
    'Simulated alert: naval incident halts tanker and container traffic in the Strait of Hormuz',
    'Simulated alert: carriers pause Gulf sailings while the Strait of Hormuz stays closed',
    'Simulated alert: war-risk insurance for Gulf shipping jumps overnight',
  ],
  red_sea: [
    'Simulated alert: new attacks on merchant ships near Bab el-Mandeb in the Red Sea',
    'Simulated alert: carriers divert Red Sea services round the Cape of Good Hope',
  ],
  suez_blockage: ['Simulated alert: grounded container ship blocks the Suez Canal, queue builds at both ends', 'Simulated alert: Suez Canal authority says salvage could take several days'],
  malacca_closure: ['Simulated alert: piracy warning slows traffic in the Strait of Malacca', 'Simulated alert: Singapore Strait traffic restricted after collision'],
  mundra_strike: ['Simulated alert: dockworkers strike stops operations at Mundra, Gujarat port strike enters second day'],
  jebel_ali_congestion: ['Simulated alert: berth delay at Jebel Ali reaches three days as port congestion builds', 'Simulated alert: Dubai port terminals report yard congestion after vessel bunching'],
  jebel_ali_shutdown: ['Simulated alert: port system outage halts gate and crane operations at Jebel Ali', 'Simulated alert: terminal shutdown at Jebel Ali after a suspected cyber attack'],
  sandstorm: ['Simulated alert: dust storm warning for Dubai, visibility under 500 m expected', 'Simulated alert: shamal winds bring low visibility to the UAE coast'],
  e311_closure: ['Simulated alert: E311 Mohammed bin Zayed Road closed near Sharjah after a major crash'],
  al_quoz_outage: ['Simulated alert: power outage hits the Al Quoz industrial area, warehouses on backup power'],
};

export function replayFeed(scenarioId: string): SignalFeed {
  const now = Date.now();
  const titles = REPLAY[scenarioId] ?? [];
  const noise = ['Simulated alert: container freight rates on Asia to Gulf lanes steady this week', 'Simulated alert: Dubai weather calm, light winds'];
  const all = [...titles, ...noise];
  return {
    fetchedAt: new Date(now).toISOString(),
    mode: 'replay',
    weather: null,
    errors: [],
    signals: all.map((title, i) => ({
      id: `r${i + 1}`,
      kind: 'replay',
      title,
      source: 'BlackRoute replay',
      publishedAt: new Date(now - (i + 1) * 47 * 60 * 1000).toISOString(),
    })),
  };
}

export async function liveFeed(): Promise<SignalFeed> {
  const res = await fetch('/api/signals');
  if (!res.ok) throw new Error(`signals ${res.status}`);
  const body = (await res.json()) as Omit<SignalFeed, 'mode'>;
  return { ...body, mode: 'live' };
}
