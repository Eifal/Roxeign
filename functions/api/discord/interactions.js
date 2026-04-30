function hexToUint8Array(hex) {
  return new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
}

async function verifyDiscordSignature(body, signature, timestamp, publicKey) {
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
  } catch (err) {
    try {
      const encoder = new TextEncoder();
      const message = encoder.encode(timestamp + body);
      const key = await crypto.subtle.importKey(
        'raw',
        hexToUint8Array(publicKey),
        { name: 'Ed25519', namedCurve: 'Ed25519' },
        false,
        ['verify']
      );
      return await crypto.subtle.verify('Ed25519', key, hexToUint8Array(signature), message);
    } catch (fallbackErr) {
      return fallbackErr.message || fallbackErr.toString();
    }
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DISCORD_PUBLIC_KEY) {
    return new Response('ERROR: DISCORD_PUBLIC_KEY is not set in this environment!', { status: 401 });
  }

  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');

  if (!signature || !timestamp) {
    return new Response('Missing signature', { status: 401 });
  }

  const bodyText = await request.text();

  // Validate request using Discord Public Key
  const isValidRequest = await verifyDiscordSignature(
    bodyText,
    signature,
    timestamp,
    env.DISCORD_PUBLIC_KEY
  );

  if (isValidRequest !== true) {
    return new Response(`Bad request signature: ${isValidRequest}`, { status: 401 });
  }

  const interaction = JSON.parse(bodyText);

  // Handle Discord Webhook Ping
  if (interaction.type === 1) { // InteractionType.PING
    return Response.json({ type: 1 }); // InteractionResponseType.PONG
  }

  // Handle Slash Commands
  if (interaction.type === 2) { // InteractionType.APPLICATION_COMMAND
    if (interaction.data.name === 'setup') {
      
      const options = interaction.data.options;
      let channelId = '';
      let mentionUser = '';
      let mentionName = '';
      let senderName = 'Bot';

      if (options) {
        for (const opt of options) {
          if (opt.name === 'channel') channelId = opt.value;
          if (opt.name === 'mention') {
            mentionUser = opt.value;
            // Ambil nama asli/display name dari payload Discord
            const resolvedUsers = interaction.data.resolved?.users;
            if (resolvedUsers && resolvedUsers[mentionUser]) {
              mentionName = resolvedUsers[mentionUser].global_name || resolvedUsers[mentionUser].username;
            }
          }
          if (opt.name === 'sender') senderName = opt.value;
        }
      }

      // Store in Cloudflare KV
      const config = {
        channelId,
        mentionUser,
        mentionName,
        senderName
      };

      await env.FACTS_KV.put('DISCORD_CONFIG', JSON.stringify(config));

      // Respond to user in Discord
      return Response.json({
        type: 4, // InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE
        data: {
          content: `✅ Setup berhasil disimpan!\n**Channel:** <#${channelId}>\n**Mention:** <@${mentionUser}>\n**Sender:** ${senderName}`,
          flags: 64 // Ephemeral (hanya dilihat oleh orang yang mengeksekusi)
        }
      });
    }
  }

  return new Response('Unknown interaction', { status: 400 });
}
