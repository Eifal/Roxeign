const https = require('https');

const APP_ID = process.env.DISCORD_APP_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!APP_ID || !BOT_TOKEN) {
  console.error("Missing DISCORD_APP_ID or DISCORD_BOT_TOKEN");
  process.exit(1);
}

const commands = [
  {
    name: 'setup',
    type: 1, // CHAT_INPUT
    description: 'Setup pengiriman fakta harian bot',
    options: [
      {
        name: 'channel',
        description: 'Channel tempat fakta akan dikirim',
        type: 7, // CHANNEL
        required: true,
      },
      {
        name: 'mention',
        description: 'User yang akan dimention setiap pagi',
        type: 6, // USER
        required: true,
      },
      {
        name: 'sender',
        description: 'Nama pengirim di bagian bawah pesan (opsional, default: Bot)',
        type: 3, // STRING
        required: false,
      },
      {
        name: 'time',
        description: 'Jam berapa fakta dikirim (0-23, contoh: 7 untuk jam 7 pagi)',
        type: 4, // INTEGER
        required: false,
      }
    ]
  }
];

const requestBody = JSON.stringify(commands);

const options = {
  hostname: 'discord.com',
  path: `/api/v10/applications/${APP_ID}/commands`,
  method: 'PUT',
  headers: {
    'Authorization': `Bot ${BOT_TOKEN}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(requestBody)
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log('✅ Slash commands berhasil didaftarkan secara global!');
    } else {
      console.error(`❌ Gagal mendaftarkan commands: ${res.statusCode} - ${data}`);
    }
  });
});

req.on('error', (e) => {
  console.error('❌ Terjadi kesalahan jaringan:', e);
});

req.write(requestBody);
req.end();
