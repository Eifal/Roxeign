const CATEGORIES = ['Sains', 'Sejarah', 'Alam', 'Luar Angkasa', 'Hewan', 'Tubuh Manusia', 'Teknologi', 'Geografi'];

/**
 * Memanggil Gemini API untuk mendapatkan fakta
 */
async function getFactFromGemini(apiKey) {
    const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
    const prompt = `Berikan SATU fakta unik tentang ${category}. Tulis persis 1 kalimat lengkap yang harus diakhiri dengan tanda titik (.). JANGAN SAMPAI KALIMAT TERPOTONG DI TENGAH. Jangan gunakan markdown atau kata pembuka.`;

    const GEMINI_MODEL = 'gemini-2.5-flash';
    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const response = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.9,
                maxOutputTokens: 1024,
                topP: 0.95,
                topK: 40,
            }
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API Error: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
}

/**
 * Endpoint Utama untuk mengirim pesan harian (Ditrigger oleh GitHub Actions)
 */
export async function onRequestPost({ request, env }) {
    // 1. Verifikasi Token Rahasia (agar tidak sembarang orang bisa nge-trigger)
    const authHeader = request.headers.get('Authorization');
    if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
        return new Response('Unauthorized', { status: 401 });
    }

    if (!env.GEMINI_API_KEY || !env.DISCORD_BOT_TOKEN) {
        return Response.json({ error: "Environment variables (GEMINI_API_KEY or DISCORD_BOT_TOKEN) are missing in Preview environment!" }, { status: 500 });
    }

    try {
        // 2. Ambil konfigurasi dari KV (yang disetup via Slash Command)
        const configStr = await env.FACTS_KV.get('DISCORD_CONFIG');
        if (!configStr) {
            return new Response('Discord config not found. Please run /setup in Discord first.', { status: 400 });
        }
        
        const config = JSON.parse(configStr);
        const { channelId, mentionUser, senderName } = config;

        // 3. Ambil Fakta dari Gemini
        const fact = await getFactFromGemini(env.GEMINI_API_KEY);
        if (!fact) {
            return new Response('Failed to generate fact', { status: 500 });
        }

        // 4. Bangun Discord Rich Embed
        const embed = {
            title: "🌟 Fun Fact Hari Ini!",
            description: `> ${fact}`,
            color: 0x2563EB, // Warna biru (primary)
            footer: {
                text: `Dikirim dari ${senderName || 'Roxeign Bot'} 🤖`
            },
            timestamp: new Date().toISOString()
        };

        const payload = {
            content: `Pagi Sayang aku <@${mentionUser}> ❤️`,
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
