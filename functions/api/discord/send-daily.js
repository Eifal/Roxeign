const CATEGORIES = [
    { key: 'sains', icon: '🔬', label: 'Sains', color: 0x3b82f6 }, // blue-500
    { key: 'sejarah', icon: '📜', label: 'Sejarah', color: 0xeab308 }, // yellow-500
    { key: 'alam', icon: '🌿', label: 'Alam', color: 0x22c55e }, // green-500
    { key: 'luar angkasa', icon: '🚀', label: 'Luar Angkasa', color: 0xa855f7 }, // purple-500
    { key: 'hewan', icon: '🐾', label: 'Hewan', color: 0xf97316 }, // orange-500
    { key: 'tubuh', icon: '🧬', label: 'Tubuh Manusia', color: 0xef4444 }, // red-500
    { key: 'teknologi', icon: '💡', label: 'Teknologi', color: 0x06b6d4 }, // cyan-500
    { key: 'geografi', icon: '🌍', label: 'Geografi', color: 0x64748b }, // slate-500
];


/**
 * Sistem Pengambil Fakta dengan Fallback Berlapis (Google & Hugging Face)
 */
async function getFactFromAI(env) {
    const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
    const prompt = `Berikan SATU fakta unik tentang ${category.label}. Tulis persis 1 kalimat lengkap yang harus diakhiri dengan tanda titik (.). JANGAN gunakan markdown atau kata pembuka.`;

    // Helper: Panggil Google Gemini
    const tryGemini = async (model) => {
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

    // Helper: Panggil Hugging Face
    const tryHF = async (model) => {
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
            // Bersihkan sisa instruksi jika ada
            if (text.includes('[/INST]')) text = text.split('[/INST]').pop();
            return text.trim() || null;
        } catch { return null; }
    };

    let factText = null;

    // --- LAPISAN 1: Google Gemini Flash ---
    const layer1 = ['gemini-1.5-flash', 'gemini-2.5-flash'];
    for (const m of layer1) {
        factText = await tryGemini(m);
        if (factText) break;
    }

    // --- LAPISAN 2: Google Gemini Pro ---
    if (!factText) {
        factText = await tryGemini('gemini-pro');
    }

    // --- LAPISAN 3: Hugging Face Mega Fallback ---
    if (!factText) {
        const hfModels = [
            'google/gemma-2-2b-it',
            'Qwen/Qwen2.5-7B-Instruct',
            'Qwen/Qwen2.5-Coder-32B-Instruct',
            'deepseek-ai/DeepSeek-R1-Distill-Llama-8B',
            'zai-org/GLM-4.5',
            'mistralai/Mistral-7B-Instruct-v0.2'
        ];
        for (const m of hfModels) {
            factText = await tryHF(m);
            if (factText) break;
        }
    }

    return { text: factText, category };
}

function cleanSenderName(name) {
    if (!name) return 'Roxeign Bot';
    // Jika user ngetag nama (format: <@1234567>), kita ganti jadi string statis
    // Karena Embed Footer tidak mendukung tag/mention Discord.
    if (name.includes('<@')) {
        return 'Kekasihmu';
    }
    return name;
}

/**
 * Endpoint Utama untuk mengirim pesan harian (Ditrigger oleh GitHub Actions)
 */
export async function onRequestPost({ request, env }) {
    const authHeader = request.headers.get('Authorization');
    if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
        return new Response('Unauthorized', { status: 401 });
    }

    if (!env.GEMINI_API_KEY || !env.DISCORD_BOT_TOKEN) {
        return Response.json({ error: "Environment variables missing!" }, { status: 500 });
    }

    try {
        const configStr = await env.FACTS_KV.get('DISCORD_CONFIG');
        if (!configStr) {
            return new Response('Discord config not found', { status: 400 });
        }
        
        const config = JSON.parse(configStr);
        const { channelId, mentionUser, mentionName, senderName } = config;

        const factData = await getFactFromAI(env);
        if (!factData || !factData.text) {
            return new Response('Failed to generate fact', { status: 500 });
        }

        const safeSender = cleanSenderName(senderName);
        const cleanSender = safeSender.replace(/[@<>\d]/g, '').trim() || safeSender;
        
        // Tampilkan nama tanpa @. Jika belum setup ulang, fallback ke kata romantis atau format biasa.
        const displayName = mentionName || "Sayang";

        const embed = {
            description: `Fun fact untuk kamu hari ini 😘\n\n**${factData.text}**`,
            color: factData.category.color,
            footer: {
                text: `Dikirim oleh kekasih kamu ${cleanSender}`
            }
        };

        const payload = {
            // Kita sematkan ping asli di belakang secara tersembunyi/kecil jika perlu, 
            // tapi karena Discord akan memunculkan @, kita hilangkan saja ping aslinya.
            // Biarkan pesan hanya teks biasa agar tidak memunculkan @nazuna
            content: `Pagi Sayang aku ❤️ <@${mentionUser}>`,
            embeds: [embed]
        };

        // 4. Simpan ke KV sebagai "Fakta Global Hari Ini" untuk sinkronisasi dengan Web
        await env.FACTS_KV.put('GLOBAL_DAILY_FACT', JSON.stringify({
            text: factData.text,
            category: factData.category,
            date: new Date().toDateString()
        }));

        const discordResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!discordResponse.ok) {
            const err = await discordResponse.text();
            throw new Error(`Discord API Error: ${discordResponse.status} - ${err}`);
        }

        return Response.json({ success: true, message: 'Fakta harian berhasil dikirim via Embed!' });
        
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
}
