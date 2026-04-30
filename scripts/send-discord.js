const https = require('https');

// Ambil rahasia dari environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_USER_ID = process.env.DISCORD_USER_ID;

if (!GEMINI_API_KEY || !DISCORD_BOT_TOKEN || !DISCORD_USER_ID) {
    console.error('Missing required environment variables.');
    process.exit(1);
}

// Konfigurasi Gemini
const GEMINI_MODEL = 'gemini-3-flash-preview';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const CATEGORIES = ['Sains', 'Sejarah', 'Alam', 'Luar Angkasa', 'Hewan', 'Tubuh Manusia', 'Teknologi', 'Geografi'];

/**
 * Memanggil Gemini API untuk mendapatkan fakta
 */
function getFactFromGemini() {
    return new Promise((resolve, reject) => {
        const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
        const prompt = `Berikan SATU fakta unik tentang ${category}. Tulis persis 1 kalimat lengkap yang harus diakhiri dengan tanda titik (.). JANGAN SAMPAI KALIMAT TERPOTONG DI TENGAH. Jangan gunakan markdown atau kata pembuka.`;

        const requestBody = JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.9,
                maxOutputTokens: 1024,
                topP: 0.95,
                topK: 40,
            }
        });

        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody)
            }
        };

        const req = https.request(GEMINI_URL, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const json = JSON.parse(data);
                        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (text) resolve(text.trim());
                        else reject(new Error('Format respons Gemini tidak valid.'));
                    } catch (e) {
                        reject(e);
                    }
                } else {
                    reject(new Error(`Gemini API Error: ${res.statusCode} - ${data}`));
                }
            });
        });

        req.on('error', reject);
        req.write(requestBody);
        req.end();
    });
}

/**
 * Membuat Channel DM (Direct Message) dengan User via Discord API
 */
function createDMChannel() {
    return new Promise((resolve, reject) => {
        const requestBody = JSON.stringify({
            recipient_id: DISCORD_USER_ID
        });

        const options = {
            hostname: 'discord.com',
            path: '/api/v10/users/@me/channels',
            method: 'POST',
            headers: {
                'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200 || res.statusCode === 201) {
                    try {
                        const json = JSON.parse(data);
                        resolve(json.id); // Mengembalikan channel_id
                    } catch (e) {
                        reject(e);
                    }
                } else {
                    reject(new Error(`Discord Create DM Error: ${res.statusCode} - ${data}`));
                }
            });
        });

        req.on('error', reject);
        req.write(requestBody);
        req.end();
    });
}

/**
 * Mengirim pesan ke Channel via Discord API
 */
function sendDiscordMessage(channelId, message) {
    return new Promise((resolve, reject) => {
        const requestBody = JSON.stringify({
            content: message
        });

        const options = {
            hostname: 'discord.com',
            path: `/api/v10/channels/${channelId}/messages`,
            method: 'POST',
            headers: {
                'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200 || res.statusCode === 201) {
                    resolve();
                } else {
                    reject(new Error(`Discord Send Message Error: ${res.statusCode} - ${data}`));
                }
            });
        });

        req.on('error', reject);
        req.write(requestBody);
        req.end();
    });
}

// ─── Eksekusi Utama ───
async function main() {
    try {
        console.log('1. Mengambil fakta dari Gemini...');
        const fact = await getFactFromGemini();
        console.log(`=> ${fact}`);

        console.log('2. Membuka DM channel di Discord...');
        const channelId = await createDMChannel();
        
        console.log('3. Mengirim pesan ke Discord...');
        const message = `Pagi Sayang aku 😘\nFun fact untuk hari ini:\n> ${fact}`;
        await sendDiscordMessage(channelId, message);

        console.log('✅ Pesan berhasil terkirim!');
    } catch (error) {
        console.error('❌ Terjadi kesalahan:', error);
        process.exit(1);
    }
}

main();
