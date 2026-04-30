// Script ini dijalankan oleh GitHub Actions setiap hari.
// Tugasnya sekarang HANYA men-trigger endpoint di Cloudflare Pages,
// karena Cloudflare Pages yang memiliki akses langsung ke Cloudflare KV (untuk membaca konfigurasi slash command).

const PAGES_URL = process.env.PAGES_URL;
const CRON_SECRET = process.env.CRON_SECRET;

if (!PAGES_URL || !CRON_SECRET) {
    console.error('Missing required environment variables (PAGES_URL or CRON_SECRET).');
    process.exit(1);
}

async function main() {
    try {
        console.log(`Mengirim perintah ke: ${PAGES_URL}/api/discord/send-daily`);
        
        const response = await fetch(`${PAGES_URL}/api/discord/send-daily`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CRON_SECRET}`
            }
        });

        const data = await response.text();

        if (response.ok) {
            console.log('✅ Berhasil:', data);
        } else {
            throw new Error(`Cloudflare API Error: ${response.status} - ${data}`);
        }
    } catch (error) {
        console.error('❌ Terjadi kesalahan:', error.message);
        process.exit(1);
    }
}

main();
