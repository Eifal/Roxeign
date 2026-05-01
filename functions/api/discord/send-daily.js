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
const DEFAULT_SETUP_HOUR = 6;
const WIB_OFFSET_HOURS = 7;

const GEMINI_MODELS = ['gemini-3-flash', 'gemini-3.1-flash', 'gemini-1.5-flash'];
const HF_MODELS = [
  'google/gemma-2-9b-it',
  'Qwen/Qwen2.5-72B-Instruct',
  'deepseek-ai/DeepSeek-R1-Distill-Llama-70B'
];

/**
 * Get the "fact day" key (YYYY-MM-DD) in WIB timezone.
 * Consistent with fact.js
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
 * Utility to clean sender name for Discord Embed Footer
 */
function getSafeSenderName(name) {
  if (!name) return DEFAULT_SENDER_NAME;
  // Embed footer doesn't support mentions, replace with static text
  if (name.includes('<@')) return 'Kekasihmu';
  // Remove special characters to keep it clean
  return name.replace(/[@<>\d]/g, '').trim() || name;
}

/**
 * Fact generation with multi-layer fallback
 */
async function getFactFromAI(env) {
  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const prompt = `Berikan SATU fakta unik tentang ${category.label}. Tulis persis 1 kalimat lengkap yang harus diakhiri dengan tanda titik (.). JANGAN gunakan markdown atau kata pembuka.`;

  const fetchGemini = async (model) => {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    } catch { return null; }
  };

  const fetchHF = async (model) => {
    try {
      if (!env.HUGGINGFACE_API_KEY) return null;
      const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${env.HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ 
          inputs: `[INST] ${prompt} [/INST]`,
          parameters: { max_new_tokens: 100 }
        })
      });
      if (!res.ok) return null;
      const result = await res.json();
      let text = (Array.isArray(result) ? result[0].generated_text : result.generated_text) || "";
      if (text.includes('[/INST]')) text = text.split('[/INST]').pop();
      return text.trim() || null;
    } catch { return null; }
  };

  let factText = null;

  // Layer 1 & 2: Google Gemini
  for (const model of GEMINI_MODELS) {
    factText = await fetchGemini(model);
    if (factText) break;
  }

  // Layer 3: Hugging Face Fallback
  if (!factText) {
    for (const model of HF_MODELS) {
      factText = await fetchHF(model);
      if (factText) break;
    }
  }

  return { text: factText, category };
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
    return Response.json({ error: "Required environment variables missing!" }, { status: 500 });
  }

  try {
    // 2. Load Config
    const configStr = await env.FACTS_KV.get('DISCORD_CONFIG');
    if (!configStr) {
      return new Response('Discord bot not configured. Use /setup command first.', { status: 400 });
    }
    
    const config = JSON.parse(configStr);
    const { channelId, mentionUser, mentionName, senderName, setupTime } = config;

    // 3. Dynamic Scheduling Check
    const userAgent = request.headers.get('User-Agent') || '';
    const isManualTrigger = userAgent.toLowerCase().includes('curl');

    if (!isManualTrigger) {
      const now = new Date();
      const currentHourWIB = (now.getUTCHours() + WIB_OFFSET_HOURS) % 24;
      const targetHour = setupTime !== undefined ? setupTime : DEFAULT_SETUP_HOUR;

      if (currentHourWIB !== targetHour) {
        return Response.json({ 
          success: true, 
          message: `Scheduled time not reached. (Current: ${currentHourWIB}, Target: ${targetHour})` 
        });
      }

      // Daily Lock to prevent duplicate sends
      const dateKey = getDateKey();
      const lastSentDate = await env.FACTS_KV.get('LAST_SENT_DATE');
      if (lastSentDate === dateKey) {
        return Response.json({ success: true, message: `Fact already sent for today (${dateKey}).` });
      }
    }

    // 4. Generate Fact
    const factData = await getFactFromAI(env);
    if (!factData?.text) {
      return new Response('AI failed to generate fact after multiple fallbacks.', { status: 500 });
    }

    // 5. Prepare Discord Payload
    const cleanSender = getSafeSenderName(senderName);
    const recipientName = mentionName || "Sayang";

    const payload = {
      content: `Pagi Sayang aku ❤️ <@${mentionUser}>`,
      embeds: [{
        description: `Fun fact untuk kamu hari ini 😘\n\n**${factData.text}**`,
        color: factData.category.color,
        footer: { text: `Dikirim oleh kekasih kamu ${cleanSender}` }
      }]
    };

    // 6. Sync with Web Cache (KV)
    const dateKey = getDateKey();
    await env.FACTS_KV.put('GLOBAL_DAILY_FACT', JSON.stringify({
      text: factData.text,
      category: factData.category,
      date: dateKey
    }));

    // 7. Send to Discord
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

    // 8. Update Lock after successful execution
    if (!isManualTrigger) {
      await env.FACTS_KV.put('LAST_SENT_DATE', getDateKey());
    }

    return Response.json({ success: true, message: 'Daily fact successfully sent!' });
    
  } catch (error) {
    console.error('Send Daily Failed:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
