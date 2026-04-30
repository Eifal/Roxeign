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
 * Memanggil Gemini API untuk mendapatkan fakta
 */
async function getFactFromGemini(apiKey) {
    const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
    const prompt = `Berikan SATU fakta unik tentang ${category.label}. Tulis persis 1 kalimat lengkap yang harus diakhiri dengan tanda titik (.). JANGAN SAMPAI KALIMAT TERPOTONG DI TENGAH. Jangan gunakan markdown atau kata pembuka.`;

/**
 * Memanggil Hugging Face API sebagai cadangan terakhir
 */
async function getFactFromHuggingFace(apiKey, categoryLabel) {
    const model = "mistralai/Mistral-7B-Instruct-v0.2";
    const prompt = `[INST] Berikan SATU fakta unik tentang ${categoryLabel} dalam Bahasa Indonesia. Tulis persis 1 kalimat lengkap. JANGAN gunakan kata pengantar. [/INST]`;
    
    const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
            inputs: prompt,
            parameters: { max_new_tokens: 150 }
        })
    });

    if (!response.ok) {
        throw new Error(`Hugging Face Error: ${response.status}`);
    }

    const result = await response.json();
    // Bersihkan teks dari instruksi jika model menyertakannya
    let fact = (Array.isArray(result) ? result[0].generated_text : result.generated_text) || "";
    return fact.split('[/INST]').pop().trim();
}

/**
 * Memanggil Gemini API untuk mendapatkan fakta
 */
async function getFactFromGemini(env) {
    const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
    const prompt = `Berikan SATU fakta unik tentang ${category.label}. Tulis persis 1 kalimat lengkap yang harus diakhiri dengan tanda titik (.). JANGAN SAMPAI KALIMAT TERPOTONG DI TENGAH. Jangan gunakan markdown atau kata pembuka.`;

    const getResponse = async (modelName) => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${env.GEMINI_API_KEY}`;
        return await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.9, maxOutputTokens: 100 }
            })
        });
    };

    let factText = "";
    
    // LAYER 1: Gemini 1.5 Flash (Sangat stabil)
    let response = await getResponse('gemini-1.5-flash');
    
    // LAYER 2: Gemini Pro (Jika Flash sibuk/error)
    if (!response.ok) {
        response = await getResponse('gemini-pro');
    }

    if (response.ok) {
        const data = await response.json();
        factText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    }

    // LAYER 3: Hugging Face (Benteng terakhir jika Google semua error)
    if (!factText && env.HUGGINGFACE_API_KEY) {
        try {
            factText = await getFactFromHuggingFace(env.HUGGINGFACE_API_KEY, category.label);
        } catch (e) {
            console.error(e);
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

        const factData = await getFactFromGemini(env);
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
            content: `Pagi Sayang aku ❤️ ${displayName}`,
            embeds: [embed]
        };

        // 5. Kirim ke Discord API
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
