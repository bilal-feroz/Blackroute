// Simple per-visitor rate limit for the server functions, so a public demo
// cannot burn through the free AI quota. In-memory, per server instance.

const hits = new Map<string, number[]>();

export function clientKey(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for') ?? '';
  return fwd.split(',')[0].trim() || request.headers.get('x-real-ip') || 'local';
}

/** true if this visitor is over `limit` requests in the last `windowMs`. */
export function limited(request: Request, limit = 40, windowMs = 60_000): boolean {
  const key = clientKey(request);
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear(); // keep memory bounded
  return list.length > limit;
}
