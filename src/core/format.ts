// Plain-English number formatting used across the app.

export function aed(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `AED ${(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 2)}M`;
  if (a >= 10_000) return `AED ${Math.round(n / 1000)}k`;
  return `AED ${Math.round(n).toLocaleString('en-US')}`;
}

export function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export function days(hours: number | null): string {
  if (hours === null) return 'not within 3 weeks';
  const d = hours / 24;
  if (d < 1) return `${Math.max(1, Math.round(hours))} h`;
  return `${d.toFixed(d < 10 ? 1 : 0)} days`;
}

export function dayTime(hour: number): string {
  const d = Math.floor(hour / 24) + 1;
  const h = Math.floor(hour % 24);
  return `Day ${d}, ${String(h).padStart(2, '0')}:00`;
}

export function tonnes(kg: number): string {
  return `${(kg / 1000).toFixed(kg >= 100_000 ? 0 : 1)} t CO₂`;
}

export function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
