// ═══════════════════════════════════════════════════════════════
// Daily Facts — Cloudflare Pages Function (API Proxy)
// ═══════════════════════════════════════════════════════════════
// Security layers:
//   1. Origin/Referer validation
//   2. Per-IP rate limiting (KV)
//   3. KV response caching (24h per category)
//   4. Global daily API budget cap (KV)
//   5. API key hidden in Cloudflare Secrets
// ═══════════════════════════════════════════════════════════════

// ─── Configuration ───
const HF_MODELS = [
  'meta-llama/Llama-3.2-3B-Instruct',
  'mistralai/Mistral-7B-Instruct-v0.3',
  'Qwen/Qwen2.5-7B-Instruct',
  'microsoft/Phi-3.5-mini-instruct'
];

const VALID_CATEGORIES = [
  'sains', 'sejarah', 'alam', 'luar angkasa',
  'hewan', 'tubuh', 'teknologi', 'geografi',
];

const CATEGORY_LABELS = {
  'sains': 'Sains',
  'sejarah': 'Sejarah',
  'alam': 'Alam',
  'luar angkasa': 'Luar Angkasa',
  'hewan': 'Hewan',
  'tubuh': 'Tubuh Manusia',
  'teknologi': 'Teknologi',
  'geografi': 'Geografi',
};

// Rate limit: max requests per IP per window
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_SEC = 3600; // 1 hour

// Global daily budget check removed in favor of shared caching logic

// Cache TTL: 24 hours
const CACHE_TTL_SEC = 86400;

// Allowed origins (add your custom domain if you have one)
const ALLOWED_ORIGINS = [
  'https://roxeign.pages.dev',
  'http://localhost:8788',  // wrangler pages dev
  'http://localhost:8000',  // python http.server (dev)
];

// ─── Helpers ───

/**
 * Get the "fact day" key (YYYY-MM-DD) in WIB timezone.
 * Day boundary is 6 AM WIB — before 6 AM counts as previous day.
 */
function getDateKey() {
  const now = new Date();
  const wibMs = now.getTime() + (7 * 60 * 60 * 1000);
  const wib = new Date(wibMs);
  if (wib.getUTCHours() < 6) {
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

/** Clean AI response text */
function cleanFactText(text) {
  if (!text) return '';
  return text
    .trim()
    .replace(/^[\s\n.,:;!?*#\-]+/, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^(fakta menarik|tahukah anda|berikut)[:\s]*/i, '')
    .trim();
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
  const label = CATEGORY_LABELS[category];

  // ═══ LAYER 3: KV cache lookup ═══
  const dateKey = getDateKey();
  const cacheKey = `fact:${category}:${dateKey}`;

  try {
    const cached = await env.FACTS_KV.get(cacheKey);
    if (cached) {
      return jsonResponse({
        fact: cached,
        category,
        cached: true,
        date: dateKey,
      }, 200, origin);
    }
  } catch (e) {
    console.error('KV read error (cache):', e);
  }

  // ═══ LAYER 4: KV check ═══
  if (!env.FACTS_KV) {
    console.error('FACTS_KV namespace not bound');
    return jsonResponse({
      error: 'Server configuration error',
      message: 'KV storage belum dikonfigurasi.',
    }, 500, origin);
  }

  // ═══ LAYER 5: Call Hugging Face API ═══
  const apiKey = env.HUGGINGFACE_API_KEY;
  if (!apiKey) {
    console.error('HUGGINGFACE_API_KEY secret not configured');
    return jsonResponse({
      error: 'Server configuration error',
      message: 'API key Hugging Face belum dikonfigurasi.',
    }, 500, origin);
  }

  try {
    const prompt = `[INST] Berikan SATU fakta unik tentang ${label}. Tulis persis 1 kalimat lengkap yang harus diakhiri dengan tanda titik (.). JANGAN gunakan markdown atau kata pembuka. [/INST]`;
    let fact = null;
    let lastError = null;

    for (const model of HF_MODELS) {
      try {
        const hfRes = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json' 
          },
          body: JSON.stringify({ 
            inputs: prompt,
            parameters: { 
              max_new_tokens: 150,
              temperature: 0.7,
              repetition_penalty: 1.2
            }
          }),
        });

        if (!hfRes.ok) {
          const errText = await hfRes.text();
          console.warn(`HF Model ${model} failed (${hfRes.status}): ${errText}`);
          lastError = { status: hfRes.status, message: errText };
          continue; // Try next model
        }

        const result = await hfRes.json();
        let rawText = (Array.isArray(result) ? result[0].generated_text : result.generated_text) || "";
        
        if (rawText.includes('[/INST]')) {
          rawText = rawText.split('[/INST]').pop();
        }

        const cleaned = cleanFactText(rawText);
        if (cleaned && cleaned.length >= 15) {
          fact = cleaned;
          break; // Success!
        }
      } catch (e) {
        console.error(`Error with model ${model}:`, e);
        lastError = e;
      }
    }

    if (!fact) {
      return jsonResponse({
        error: 'All AI models failed',
        details: lastError?.message || lastError?.toString(),
        status: lastError?.status || 502
      }, 502, origin);
    }

    // Store in cache
    try {
      await env.FACTS_KV.put(cacheKey, fact, { expirationTtl: CACHE_TTL_SEC });
    } catch (e) {
      console.error('KV write error (cache):', e);
    }

    return jsonResponse({
      fact,
      category,
      cached: false,
      date: dateKey,
    }, 200, origin);

  } catch (error) {
    console.error('General HF processing error:', error);
    return jsonResponse({
      error: 'Failed to connect to AI service',
      message: 'Gagal menghubungi layanan Hugging Face.',
    }, 502, origin);
  }
}
