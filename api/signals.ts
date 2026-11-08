// GET /api/signals -> live signals for the Sentinel agent:
//  - recent shipping-disruption news from the GDELT 2.0 DOC API (free, no key),
//    falling back to a Google News RSS search when GDELT is busy
//  - Dubai wind, visibility and dust forecast from Open-Meteo (free, no key)
// Results are cached for 10 minutes so the free APIs are not hammered.

import { json } from './_lib/llm';

export interface Signal {
  id: string;
  kind: 'news' | 'weather';
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

const GDELT_QUERY =
  '("strait of hormuz" OR "red sea shipping" OR "suez canal" OR "bab el-mandeb" OR "jebel ali" OR "strait of malacca" OR "port strike" OR "port congestion" OR "shipping disruption" OR "container shipping") sourcelang:english';

let cache: { at: number; body: unknown } | null = null;
const TTL = 10 * 60 * 1000;

async function getJson<T>(url: string, ms = 15000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'BlackRoute/0.1 (logistics demo)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    // GDELT answers with plain text when it is rate limiting
    if (!text.trimStart().startsWith('{')) throw new Error('source busy, try again shortly');
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(t);
  }
}

function gdeltDate(s: string): string {
  // 20261108T101500Z -> ISO
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : s;
}

async function news(): Promise<Signal[]> {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(GDELT_QUERY)}&mode=artlist&maxrecords=40&format=json&timespan=7d&sort=datedesc`;
  const data = await getJson<{ articles?: { url: string; title: string; seendate: string; domain: string }[] }>(url);
  const seen = new Set<string>();
  const out: Signal[] = [];
  for (const a of data.articles ?? []) {
    const title = (a.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 220);
    const key = title.toLowerCase().slice(0, 60);
    if (!title || seen.has(key)) continue;
    seen.add(key);
    out.push({ id: `n${out.length + 1}`, kind: 'news', title, source: a.domain, url: a.url, publishedAt: gdeltDate(a.seendate) });
    if (out.length >= 24) break;
  }
  return out;
}

const RSS_QUERY = '"strait of hormuz" OR "red sea" shipping OR "suez canal" OR "jebel ali" OR "port congestion" OR "port strike" OR "shipping disruption" when:7d';

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

/** Fallback news source: Google News RSS search (free, no key). */
async function rssNews(): Promise<Signal[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(RSS_QUERY)}&hl=en-US&gl=US&ceid=US:en`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'BlackRoute/0.1 (logistics demo)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const out: Signal[] = [];
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const item = m[1];
      const get = (tag: string) => decode(item.match(new RegExp(String.raw`<${tag}[^>]*>([\s\S]*?)</${tag}>`))?.[1] ?? '');
      const source = get('source') || 'news';
      let title = get('title');
      if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
      const date = new Date(get('pubDate'));
      out.push({ id: `n${out.length + 1}`, kind: 'news', title: title.slice(0, 220), source, url: get('link'), publishedAt: isNaN(+date) ? new Date().toISOString() : date.toISOString() });
      if (out.length >= 24) break;
    }
    return out;
  } finally {
    clearTimeout(t);
  }
}

async function weather(): Promise<{ signal: Signal | null; summary: WeatherSummary }> {
  const lat = 25.05;
  const lon = 55.15;
  const [wx, aq] = await Promise.all([
    getJson<{ hourly?: { visibility?: number[]; wind_gusts_10m?: number[] } }>(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=visibility,wind_gusts_10m&forecast_days=3&timezone=Asia%2FDubai`,
    ),
    getJson<{ hourly?: { dust?: number[] } }>(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=dust&forecast_days=3`).catch(() => ({ hourly: { dust: [] } })),
  ]);
  const gusts = (wx.hourly?.wind_gusts_10m ?? []).filter((x) => typeof x === 'number');
  const vis = (wx.hourly?.visibility ?? []).filter((x) => typeof x === 'number');
  const dust = (aq.hourly?.dust ?? []).filter((x) => typeof x === 'number');
  const summary: WeatherSummary = {
    maxGustKmh: Math.round(Math.max(0, ...gusts)),
    minVisibilityM: Math.round(vis.length ? Math.min(...vis) : 10000),
    maxDust: Math.round(Math.max(0, ...dust)),
    hazard: false,
  };
  summary.hazard = summary.maxGustKmh >= 55 || summary.minVisibilityM < 1500 || summary.maxDust >= 600;
  const signal: Signal | null = summary.hazard
    ? {
        id: 'w1',
        kind: 'weather',
        title: `Dubai forecast: gusts up to ${summary.maxGustKmh} km/h, visibility down to ${summary.minVisibilityM} m, dust ${summary.maxDust} µg/m³ in the next 3 days`,
        source: 'open-meteo.com',
        url: 'https://open-meteo.com/',
        publishedAt: new Date().toISOString(),
      }
    : null;
  return { signal, summary };
}

export async function GET(): Promise<Response> {
  if (cache && Date.now() - cache.at < TTL) return json(cache.body);
  const errors: string[] = [];
  const [n, w] = await Promise.all([
    news()
      .then((list) => (list.length ? list : rssNews()))
      .catch((e) => {
        errors.push(`gdelt: ${(e as Error).message}`);
        return rssNews().catch((e2) => {
          errors.push(`rss: ${(e2 as Error).message}`);
          return [] as Signal[];
        });
      }),
    weather().catch((e) => {
      errors.push(`weather: ${(e as Error).message}`);
      return null;
    }),
  ]);
  const signals = [...(w?.signal ? [w.signal] : []), ...n];
  const body = { fetchedAt: new Date().toISOString(), signals, weather: w?.summary ?? null, errors };
  if (signals.length || w) cache = { at: Date.now(), body };
  return json(body);
}
