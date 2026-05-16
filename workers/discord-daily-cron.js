const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

function getPagesEndpoint(env) {
  const baseUrl = env.PAGES_URL?.replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('PAGES_URL secret/variable is not configured.');
  }
  return `${baseUrl}/api/discord/send-daily`;
}

async function triggerDailyFact(env) {
  if (!env.CRON_SECRET) {
    throw new Error('CRON_SECRET secret is not configured.');
  }

  const response = await fetch(getPagesEndpoint(env), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.CRON_SECRET}`,
    },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Pages endpoint failed (${response.status}): ${body}`);
  }

  return body;
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(triggerDailyFact(env));
  },

  async fetch(_request, env) {
    try {
      const body = await triggerDailyFact(env);
      return new Response(body, {
        status: 200,
        headers: JSON_HEADERS,
      });
    } catch (error) {
      return Response.json(
        { error: error.message || 'Failed to trigger daily fact.' },
        { status: 500, headers: JSON_HEADERS },
      );
    }
  },
};
