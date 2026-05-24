/**
 * Endpoint untuk mengambil fakta harian yang sinkron dengan Discord
 */
function isCompleteFact(text) {
    if (!text || text.length < 25 || text.length > 260) return false;
    if (!/[.!?]$/.test(text)) return false;
    if (/[,:;]$/.test(text)) return false;
    return text.split(/\s+/).length >= 6;
}

export async function onRequestGet({ env }) {
    try {
        const dailyFact = await env.FACTS_KV.get('GLOBAL_DAILY_FACT');
        
        if (!dailyFact) {
            return Response.json({ 
                error: 'No daily fact found. Discord bot might not have run today.' 
            }, { status: 404 });
        }

        const parsed = JSON.parse(dailyFact);
        if (!isCompleteFact(parsed?.text)) {
            return Response.json({
                error: 'Stored daily fact is incomplete. Scheduler should generate a fresh fact.'
            }, { status: 422 });
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
