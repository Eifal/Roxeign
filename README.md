# Daily Facts 

Aplikasi web sederhana yang menampilkan fakta menarik setiap hari. Ditenagai oleh AI untuk memberikan wawasan singkat seputar sains, alam, teknologi, dan lainnya dengan antarmuka yang bersih dan modern.

## Fitur
- Pembaruan fakta otomatis setiap hari.
- Mode offline fallback.
- Caching cerdas untuk optimasi performa.

## Scheduler Discord

Scheduler yang lebih presisi bisa dijalankan memakai Cloudflare Workers Cron Trigger:

```powershell
npm run deploy:cron
```

Worker cron memakai jadwal `0 0 * * *` UTC, setara dengan 07:00 WIB. Setelah deploy, set secret/variable berikut pada Worker `roxeign-discord-daily-cron`:

- `PAGES_URL`: URL Cloudflare Pages production, contoh `https://roxeign.pages.dev`
- `CRON_SECRET`: nilai yang sama dengan secret `CRON_SECRET` di Pages Function

Worker hanya memanggil endpoint Pages `/api/discord/send-daily`, jadi token Discord, HuggingFace API key, dan KV tetap dikelola oleh Pages Function.
