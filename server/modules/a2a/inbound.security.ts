/**
 * A2A inbound security — prompt-injection sanitization + per-IP rate limiting.
 *
 * Ported from hermes-a2a `plugin/security.py` (the inbound half:
 * `sanitize_inbound` + `RateLimiter`). Outbound redaction / audit logging live
 * elsewhere; this module only touches *incoming* remote-agent payloads before
 * they reach the model.
 *
 * Design notes:
 *  - All `INJECTION_PATTERNS` carry a global (`g`) flag so `.replace()` strips
 *    every occurrence in one pass. Because stateful global regexes remember
 *    `lastIndex` between calls, each pattern's `lastIndex` is reset to 0 before
 *    the `test` + `replace` pair — otherwise a prior match could make `test`
 *    falsely report "no match" on reuse (JS `/g` + `test` footgun).
 *  - `RateLimiter` uses a sliding window per IP (ms granularity via `Date.now`).
 */

const INJECTION_PATTERNS = [
  /<\s*system\s*>.*?<\s*\/\s*system\s*>/gsi,
  /\[INST\].*?\[\/INST\]/gsi,
  /ignore\s+(all\s+)?previous\s+instructions?/gi,
  /you\s+are\s+now\s+/gi,
  /new\s+system\s+prompt/gi,
  /disregard\s+(all\s+)?(prior|earlier|above)/gi,
  /override\s+(your\s+)?(instructions?|rules?|guidelines?)/gi,
  /<\|im_(start|end)\|>/g,
  /^(Human|Assistant|System)\s*:/gmi,
];

/**
 * Sanitize an inbound A2A message: cap its length then replace any known
 * prompt-injection payload with `[FILTERED]`.
 *
 * @param text Raw incoming message text.
 * @param maxLength Hard cap in chars; over-long input is truncated and tagged
 *                  with `[... message truncated for safety]`. Defaults 50_000.
 * @returns Sanitized text safe to forward to the model.
 */
export function sanitizeInbound(text: string, maxLength = 50_000): string {
  let t = text;
  if (t.length > maxLength) t = t.slice(0, maxLength) + '\n[... message truncated for safety]';
  for (const p of INJECTION_PATTERNS) {
    p.lastIndex = 0;
    if (p.test(t)) t = t.replace(p, '[FILTERED]');
  }
  return t;
}

/**
 * Sliding-window per-key rate limiter (default 20 requests / 60s).
 *
 * Not thread-safe in the Python sense, but JS is single-threaded so the
 * per-IP array mutations are safe without a lock. Memory grows with the
 * number of distinct IPs seen within the window; callers that expose this
 * to untrusted clients should pair it with upstream eviction.
 */
export class RateLimiter {
  private buckets = new Map<string, number[]>();

  constructor(private maxRequests = 20, private windowMs = 60_000) {}

  /**
   * Record a request attempt for `ip` and decide whether it is allowed.
   * @returns `true` if the request is within the limit, `false` if denied.
   */
  allow(ip: string): boolean {
    const now = Date.now();
    const arr = (this.buckets.get(ip) || []).filter(ts => ts > now - this.windowMs);
    if (arr.length >= this.maxRequests) {
      this.buckets.set(ip, arr);
      return false;
    }
    arr.push(now);
    this.buckets.set(ip, arr);
    return true;
  }
}
