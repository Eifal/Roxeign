const CATEGORIES = [
  { key: 'sains', icon: '🔬', label: 'Sains', color: 0x3b82f6 },
  { key: 'sejarah', icon: '📜', label: 'Sejarah', color: 0xeab308 },
  { key: 'alam', icon: '🌿', label: 'Alam', color: 0x22c55e },
  { key: 'luar angkasa', icon: '🚀', label: 'Luar Angkasa', color: 0xa855f7 },
  { key: 'hewan', icon: '🐾', label: 'Hewan', color: 0xf97316 },
  { key: 'tubuh', icon: '🧬', label: 'Tubuh Manusia', color: 0xef4444 },
  { key: 'teknologi', icon: '💡', label: 'Teknologi', color: 0x06b6d4 },
  { key: 'geografi', icon: '🌍', label: 'Geografi', color: 0x64748b },
];

const DEFAULT_SENDER_NAME = 'Roxeign Bot';
const DEFAULT_SETUP_HOUR = 7;
const WIB_OFFSET_HOURS = 7;
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/**
 * Get the "fact day" key (YYYY-MM-DD) in WIB timezone.
 * Consistent with fact.js
 */
function getDateKey() {
  const now = new Date();
  const wibMs = now.getTime() + (7 * 60 * 60 * 1000);
  const wib = new Date(wibMs);
  if (wib.getUTCHours() < DEFAULT_SETUP_HOUR) {
    wib.setUTCDate(wib.getUTCDate() - 1);
  }
  return wib.toISOString().split('T')[0];
}

/**
 * Utility to clean sender name for Discord Embed Footer
 */
function getSafeSenderName(name) {
  if (!name) return DEFAULT_SENDER_NAME;
  if (name.includes('<@')) return 'Kekasihmu';
  return name.replace(/[@<>\d]/g, '').trim() || name;
}

function isValidDiscordSnowflake(value) {
  return typeof value === 'string' && /^\d{17,20}$/.test(value);
}

function getTargetHour(config) {
  if (config?.setupTimeExplicit !== true) {
    return DEFAULT_SETUP_HOUR;
  }

  const { setupTime } = config;
  const parsed = Number(setupTime);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23
    ? parsed
    : DEFAULT_SETUP_HOUR;
}

function buildFactPrompt(label) {
  return [
    `Berikan SATU fakta unik tentang ${label}.`,
    'Fakta harus benar, mapan, dan mudah diverifikasi dari pengetahuan umum atau sumber tepercaya.',
    'Hindari angka yang terlalu spesifik jika tidak yakin.',
    'Tulis dalam Bahasa Indonesia, persis 1 kalimat lengkap, maksimal 32 kata, dan akhiri dengan tanda titik.',
    'Jangan gunakan markdown, emoji, kutipan, sumber, atau kata pembuka seperti "Tahukah Anda".'
  ].join(' ');
}

function cleanFactText(text) {
  if (!text) return '';
  return text
    .trim()
    .replace(/^[\s\n.,:;!?*#\-]+/, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^(fakta menarik|fakta unik|tahukah anda|berikut)[:\s]*/i, '')
    .trim();
}

function extractGeminiText(result) {
  return result?.candidates?.[0]?.content?.parts
    ?.map(part => part.text || '')
    .join(' ')
    .trim() || '';
}

function buildGeminiRequest(label) {
  return {
    contents: [{
      role: 'user',
      parts: [{ text: buildFactPrompt(label) }]
    }],
    generationConfig: {
      maxOutputTokens: 180,
      temperature: 0.35,
      topP: 0.8,
      thinkingConfig: {
        thinkingBudget: 0,
      },
    },
  };
}

function isCompleteFact(text) {
  if (!text || text.length < 25 || text.length > 260) return false;
  if (!/[.!?]$/.test(text)) return false;
  if (/[,:;]$/.test(text)) return false;
  return text.split(/\s+/).length >= 6;
}

/**
 * Fact generation with Gemini
 */
async function getFactFromAI(env) {
  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];

  if (!env.GEMINI_API_KEY) {
    return { text: null, category };
  }

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': env.GEMINI_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(buildGeminiRequest(category.label))
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`Gemini model ${GEMINI_MODEL} failed (${response.status}): ${errorText}`);
      return { text: null, category };
    }

    const result = await response.json();
    if (result?.candidates?.[0]?.finishReason !== 'STOP') {
      console.warn(`Gemini model ${GEMINI_MODEL} stopped early: ${result?.candidates?.[0]?.finishReason || 'unknown'}`);
      return { text: null, category };
    }

    const factText = cleanFactText(extractGeminiText(result));
    return {
      text: isCompleteFact(factText) ? factText : null,
      category,
      model: GEMINI_MODEL,
    };
  } catch (e) {
    console.warn('Error with Gemini:', e.message);
    return { text: null, category };
  }
}

/**
 * Main Daily Fact Trigger (GitHub Actions / Manual)
 */
export async function onRequestPost({ request, env }) {
  // 1. Security Check
  const authHeader = request.headers.get('Authorization');
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!env.GEMINI_API_KEY || !env.DISCORD_BOT_TOKEN) {
    return Response.json({ error: "Required environment variables missing (GEMINI_API_KEY or DISCORD_BOT_TOKEN)!" }, { status: 500 });
  }

  try {
    // 2. Load Config
    const configStr = await env.FACTS_KV.get('DISCORD_CONFIG');
    if (!configStr) {
      return new Response('Discord bot not configured. Use /setup command first.', { status: 400 });
    }
    
    const config = JSON.parse(configStr);
    const { channelId, mentionUser, senderName } = config;

    if (!isValidDiscordSnowflake(channelId) || !isValidDiscordSnowflake(mentionUser)) {
      return Response.json({
        error: 'Discord configuration is invalid. Run /setup again with a valid channel and mention user.'
      }, { status: 400 });
    }

    // 3. Dynamic Scheduling Check
    const userAgent = request.headers.get('User-Agent') || '';
    const isManualTrigger = userAgent.toLowerCase().includes('curl');

    if (!isManualTrigger) {
      const now = new Date();
      const currentHourWIB = (now.getUTCHours() + WIB_OFFSET_HOURS) % 24;
      const targetHour = getTargetHour(config);

      if (currentHourWIB < targetHour) {
        return Response.json({ 
          success: true, 
          sent: false,
          skipped: true,
          reason: 'outside_schedule',
          message: `Scheduled time not reached. (Current: ${currentHourWIB}, Target: ${targetHour})` 
        });
      }

      // Daily Lock to prevent duplicate sends
      const dateKey = getDateKey();
      const lastSentDate = await env.FACTS_KV.get('LAST_SENT_DATE');
      if (lastSentDate === dateKey) {
        return Response.json({
          success: true,
          sent: false,
          skipped: true,
          reason: 'already_sent',
          message: `Fact already sent for today (${dateKey}).`
        });
      }
    }

    // 4. Generate Fact
    const factData = await getFactFromAI(env);
    if (!factData?.text) {
      return new Response('Gemini failed to generate fact.', { status: 500 });
    }

    // 5. Prepare Discord Payload
    const cleanSender = getSafeSenderName(senderName);

    const payload = {
      content: `Pagi Sayang aku ❤️ <@${mentionUser}>`,
      embeds: [{
        description: `Fun fact untuk kamu hari ini 😘\n\n**${factData.text}**`,
        color: factData.category.color,
        footer: { text: `Dikirim oleh kekasih kamu ${cleanSender}` }
      }]
    };

    // 6. Send to Discord
    const discordRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!discordRes.ok) {
      const errorText = await discordRes.text();
      throw new Error(`Discord API Error: ${discordRes.status} - ${errorText}`);
    }

    // 7. Sync with Web Cache (KV) only after Discord accepts the message.
    const dateKey = getDateKey();
    await env.FACTS_KV.put('GLOBAL_DAILY_FACT', JSON.stringify({
      text: factData.text,
      category: factData.category,
      date: dateKey,
      provider: 'gemini',
      model: factData.model || GEMINI_MODEL
    }));

    // 8. Update Lock after successful execution
    if (!isManualTrigger) {
      await env.FACTS_KV.put('LAST_SENT_DATE', getDateKey());
    }

    return Response.json({ success: true, sent: true, message: 'Daily fact successfully sent!' });
    
  } catch (error) {
    console.error('Send Daily Failed:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
