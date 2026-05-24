// ═══════════════════════════════════════════════════════════════
// Daily Facts — Cloudflare Pages Function (API Proxy)
// ═══════════════════════════════════════════════════════════════
// Security layers:
//   1. Origin/Referer validation
//   2. Per-IP rate limiting (KV)
//   3. Shared KV/global fact lookup
//   4. KV Binding validation
// ═══════════════════════════════════════════════════════════════

// ─── Configuration ───
const VALID_CATEGORIES = [
  'sains', 'sejarah', 'alam', 'luar angkasa',
  'hewan', 'tubuh', 'teknologi', 'geografi',
];

// Rate limit: max requests per IP per window.
// This endpoint no longer calls AI, so the public read limit can be generous.
const RATE_LIMIT_MAX = 120;
const RATE_LIMIT_WINDOW_SEC = 3600; // 1 hour

// Allowed origins (add your custom domain if you have one)
const ALLOWED_ORIGINS = [
  'https://roxeign.pages.dev',
  'http://localhost:8788',  // wrangler pages dev
  'http://localhost:8000',  // python http.server (dev)
];

// ─── Helpers ───

/**
 * Get the "fact day" key (YYYY-MM-DD) in WIB timezone.
 * Day boundary is 7 AM WIB — before 7 AM counts as previous day.
 */
function getDateKey() {
  const now = new Date();
  const wibMs = now.getTime() + (7 * 60 * 60 * 1000);
  const wib = new Date(wibMs);
  if (wib.getUTCHours() < 7) {
    wib.setUTCDate(wib.getUTCDate() - 1);
  }
  return wib.toISOString().split('T')[0];
}

/**
 * Check if the request origin is allowed.
 * Empty origin = same-origin request (allowed).
 */
function isOriginAllowed(origin) {
  if (!origin) return true; // same-origin requests don't send Origin header
  return ALLOWED_ORIGINS.some(allowed => origin === allowed || origin.endsWith('.roxeign.pages.dev'));
}

/** Build CORS headers */
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

/** JSON response helper */
function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin),
    },
  });
}

function parseStoredDailyFact(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return isCompleteFact(parsed?.text) ? parsed : null;
  } catch {
    return null;
  }
}

function isCompleteFact(text) {
  if (!text || text.length < 25 || text.length > 260) return false;
  if (!/[.!?]$/.test(text)) return false;
  if (/[,:;]$/.test(text)) return false;
  return text.split(/\s+/).length >= 6;
}

// ─── Main Handler ───

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const origin = request.headers.get('Origin') || '';

  // ── CORS preflight ──
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  // ── Only GET allowed ──
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }

  // ═══ LAYER 1: Origin validation ═══
  if (!isOriginAllowed(origin)) {
    return jsonResponse({ error: 'Forbidden: origin not allowed' }, 403, origin);
  }

  // ═══ LAYER 2: Per-IP rate limiting ═══
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rateWindow = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SEC * 1000));
  const rateLimitKey = `rate:${ip}:${rateWindow}`;

  let currentRate = 0;
  try {
    currentRate = parseInt(await env.FACTS_KV.get(rateLimitKey) || '0');
  } catch (e) {
    console.error('KV read error (rate limit):', e);
  }

  if (currentRate >= RATE_LIMIT_MAX) {
    return jsonResponse({
      error: 'Rate limit exceeded',
      message: 'Terlalu banyak request. Coba lagi dalam 1 jam.',
      retryAfter: RATE_LIMIT_WINDOW_SEC,
    }, 429, origin);
  }

  // Increment rate counter (fire-and-forget is fine)
  try {
    await env.FACTS_KV.put(rateLimitKey, String(currentRate + 1), {
      expirationTtl: RATE_LIMIT_WINDOW_SEC,
    });
  } catch (e) {
    console.error('KV write error (rate limit):', e);
  }

  // ── Parse & validate category ──
  const catParam = url.searchParams.get('cat') || 'sains';
  const category = VALID_CATEGORIES.includes(catParam) ? catParam : 'sains';

  // ═══ LAYER 3: Fact day and fallback category ═══
  const dateKey = getDateKey();

  // ═══ LAYER 4: KV Binding Check ═══
  if (!env.FACTS_KV) {
    console.error('FACTS_KV namespace not bound');
    return jsonResponse({
      error: 'Server configuration error',
      message: 'Layanan penyimpanan (KV) belum terhubung.',
    }, 500, origin);
  }

  try {
    const globalDailyFact = parseStoredDailyFact(await env.FACTS_KV.get('GLOBAL_DAILY_FACT'));

    if (!globalDailyFact) {
      return jsonResponse({
        fact: null,
        category,
        fallback: true,
        cached: false,
        date: dateKey,
        message: 'Belum ada fakta harian dari scheduler. Gunakan fallback lokal.'
      }, 200, origin);
    }

    return jsonResponse({
      fact: globalDailyFact.text,
      category: globalDailyFact.category?.key || globalDailyFact.category || category,
      cached: true,
      date: globalDailyFact.date || dateKey,
      provider: globalDailyFact.provider || 'kv',
      source: 'GLOBAL_DAILY_FACT',
    }, 200, origin);

  } catch (error) {
    console.error('KV fact lookup error:', error);
    return jsonResponse({
      error: 'Failed to read daily fact',
      message: 'Gagal membaca fakta harian.',
    }, 500, origin);
  }
}
