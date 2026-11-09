// Grounding check: every number an agent writes must come from the tool results
// it was given. Anything else is flagged so a human can see it.

function collectNumbers(value: unknown, out: number[]) {
  if (typeof value === 'number') out.push(value);
  else if (typeof value === 'string') for (const m of value.matchAll(/-?\d[\d,]*\.?\d*/g)) out.push(Number(m[0].replace(/,/g, '')));
  else if (Array.isArray(value)) for (const v of value) collectNumbers(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectNumbers(v, out);
}

export interface Grounding {
  checked: number;
  unsupported: string[];
  ok: boolean;
}

export function checkGrounding(output: unknown, ...sources: unknown[]): Grounding {
  const allowed: number[] = [];
  for (const s of sources) collectNumbers(s, allowed);
  const text: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') text.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(output);
  const unsupported: string[] = [];
  let checked = 0;
  for (const t of text) {
    for (const m of t.matchAll(/(-?\d[\d,]*\.?\d*)\s*([kKmM%])?/g)) {
      const rawNum = Number(m[1].replace(/,/g, ''));
      if (!isFinite(rawNum)) continue;
      // small counts (two ships, three days, day 4) are not worth flagging
      if (Math.abs(rawNum) <= 12 && !m[2]) continue;
      checked++;
      const unit = m[2];
      // "AED 15k" may stand for 14,600: allow half a step of the shown precision
      const decimals = (m[1].split('.')[1] ?? '').length;
      const step = 10 ** -decimals;
      const candidates: { n: number; slack: number }[] = [{ n: rawNum, slack: 0 }];
      if (unit === 'k' || unit === 'K') candidates.push({ n: rawNum * 1000, slack: (step * 1000) / 2 });
      if (unit === 'm' || unit === 'M') candidates.push({ n: rawNum * 1_000_000, slack: (step * 1_000_000) / 2 });
      if (unit === '%') candidates.push({ n: rawNum / 100, slack: 0 });
      const ok = candidates.some(({ n, slack }) =>
        allowed.some((a) => {
          const tol = Math.max(0.6, Math.abs(a) * 0.015, slack);
          return Math.abs(a - n) <= tol || Math.abs(a * 100 - n) <= Math.max(0.6, Math.abs(a * 100) * 0.015);
        }),
      );
      if (!ok) unsupported.push(m[0].trim());
    }
  }
  return { checked, unsupported, ok: unsupported.length === 0 };
}
