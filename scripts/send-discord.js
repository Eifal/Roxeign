// Script ini dijalankan oleh GitHub Actions setiap hari.
// Tugasnya HANYA men-trigger endpoint di Cloudflare Pages,
// karena Cloudflare Pages punya akses langsung ke Cloudflare KV.

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

        if (!response.ok) {
            throw new Error(`Cloudflare API Error: ${response.status} - ${data}`);
        }

        let parsed = null;
        try {
            parsed = JSON.parse(data);
        } catch (error) {
            // Keep raw output for non-JSON responses.
        }

        if (parsed?.skipped) {
            console.log('Dilewati:', parsed.message || data);
            return;
        }

        if (parsed?.sent === true) {
            console.log('Berhasil dikirim:', parsed.message || data);
            return;
        }

        console.log('Berhasil:', data);
    } catch (error) {
        console.error('Terjadi kesalahan:', error.message);
        process.exit(1);
    }
}

main();
