const INTERACTION_TYPE_PING = 1;
const INTERACTION_TYPE_COMMAND = 2;
const RESPONSE_TYPE_PONG = 1;
const RESPONSE_TYPE_CHANNEL_MESSAGE = 4;
const DEFAULT_SETUP_HOUR = 7;

/**
 * Utility to convert Hex string to Uint8Array
 */
function hexToUint8Array(hex) {
  return new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
}

/**
 * Verify Discord Webhook Signature using WebCrypto API
 */
async function verifyDiscordSignature(body, signature, timestamp, publicKey) {
  try {
    const encoder = new TextEncoder();
    const message = encoder.encode(timestamp + body);
    
    // Cloudflare supports Ed25519 in WebCrypto
    const key = await crypto.subtle.importKey(
      'raw',
      hexToUint8Array(publicKey),
      { name: 'Ed25519', namedCurve: 'Ed25519' },
      false,
      ['verify']
    );
    
    return await crypto.subtle.verify('Ed25519', key, hexToUint8Array(signature), message);
  } catch (err) {
    // Fallback for different environment implementations of Ed25519
    try {
      const encoder = new TextEncoder();
      const message = encoder.encode(timestamp + body);
      const key = await crypto.subtle.importKey(
        'raw',
        hexToUint8Array(publicKey),
        { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' },
        false,
        ['verify']
      );
      return await crypto.subtle.verify('NODE-ED25519', key, hexToUint8Array(signature), message);
    } catch (fallbackErr) {
      return fallbackErr.message || fallbackErr.toString();
    }
  }
}

function getSafeSetupHour(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23
    ? parsed
    : DEFAULT_SETUP_HOUR;
}

/**
 * Main Interaction Handler
 */
export async function onRequestPost({ request, env }) {
  if (!env.DISCORD_PUBLIC_KEY) {
    return new Response('Environment Error: DISCORD_PUBLIC_KEY missing', { status: 500 });
  }

  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');

  if (!signature || !timestamp) {
    return new Response('Unauthorized: Missing signature headers', { status: 401 });
  }

  const bodyText = await request.text();
  const isValidRequest = await verifyDiscordSignature(
    bodyText,
    signature,
    timestamp,
    env.DISCORD_PUBLIC_KEY
  );

  if (isValidRequest !== true) {
    return new Response(`Unauthorized: Invalid signature (${isValidRequest})`, { status: 401 });
  }

  const interaction = JSON.parse(bodyText);

  // 1. Handle Ping
  if (interaction.type === INTERACTION_TYPE_PING) {
    return Response.json({ type: RESPONSE_TYPE_PONG });
  }

  // 2. Handle Application Commands
  if (interaction.type === INTERACTION_TYPE_COMMAND) {
    const { name, options } = interaction.data;

    if (name === 'setup') {
      let channelId = '';
      let mentionUser = '';
      let mentionName = '';
      let senderName = 'Bot';
      let setupTime = DEFAULT_SETUP_HOUR;
      let setupTimeExplicit = false;

      if (options) {
        for (const opt of options) {
          switch (opt.name) {
            case 'channel': channelId = opt.value; break;
            case 'mention':
              mentionUser = opt.value;
              const resolvedUsers = interaction.data.resolved?.users;
              if (resolvedUsers?.[mentionUser]) {
                mentionName = resolvedUsers[mentionUser].global_name || resolvedUsers[mentionUser].username;
              }
              break;
            case 'sender': senderName = opt.value; break;
            case 'time':
              setupTime = getSafeSetupHour(opt.value);
              setupTimeExplicit = true;
              break;
          }
        }
      }

      const config = {
        channelId,
        mentionUser,
        mentionName,
        senderName,
        setupTime: getSafeSetupHour(setupTime),
        setupTimeExplicit
      };

      await env.FACTS_KV.put('DISCORD_CONFIG', JSON.stringify(config));

      return Response.json({
        type: RESPONSE_TYPE_CHANNEL_MESSAGE,
        data: {
          content: `✅ **Setup berhasil disimpan!**\n\n**Channel:** <#${channelId}>\n**Mention:** <@${mentionUser}>\n**Sender:** ${senderName}\n**Jadwal:** Setiap jam ${setupTime}:00 WIB`,
          flags: 64 // Ephemeral
        }
      });
    }
  }

  return new Response('Bad Request: Unknown interaction', { status: 400 });
}
