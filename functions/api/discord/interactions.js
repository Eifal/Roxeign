import { verifyKey } from 'discord-interactions';

export async function onRequestPost({ request, env }) {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');

  if (!signature || !timestamp) {
    return new Response('Missing signature', { status: 401 });
  }

  const bodyText = await request.text();

  // Validate request using Discord Public Key
  const isValidRequest = verifyKey(
    bodyText,
    signature,
    timestamp,
    env.DISCORD_PUBLIC_KEY
  );

  if (!isValidRequest) {
    return new Response('Bad request signature', { status: 401 });
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
      let senderName = 'Bot';

      if (options) {
        for (const opt of options) {
          if (opt.name === 'channel') channelId = opt.value;
          if (opt.name === 'mention') mentionUser = opt.value;
          if (opt.name === 'sender') senderName = opt.value;
        }
      }

      // Store in Cloudflare KV
      const config = {
        channelId,
        mentionUser,
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
