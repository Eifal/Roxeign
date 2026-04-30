/**
 * Endpoint untuk mengambil fakta harian yang sinkron dengan Discord
 */
export async function onRequestGet({ env }) {
    try {
        const dailyFact = await env.FACTS_KV.get('GLOBAL_DAILY_FACT');
        
        if (!dailyFact) {
            return Response.json({ 
                error: 'No daily fact found. Discord bot might not have run today.' 
            }, { status: 404 });
        }

        return new Response(dailyFact, {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
            }
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
}
