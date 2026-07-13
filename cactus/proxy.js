export async function onRequest(context) {
    const { env } = context;

    try {
        const result = await env.DB.prepare(`
            SELECT id, name, base_url
            FROM providers
            WHERE enabled = 1
            ORDER BY priority DESC
        `).all();

        const api_site = {};
        result.results.forEach(p => {
            let key = p.id;
            try {
                key = new URL(p.base_url).hostname;
            } catch (e) {
                key = p.id;
            }
            api_site[key] = {
                name: p.name,
                api: p.base_url,
                detail: key
            };
        });

        const json = JSON.stringify({
            cache_time: 7200,
            api_site: api_site
        });

        // 返回纯 JSON
        return new Response(json, {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (error) {
        return new Response(JSON.stringify({ code: 500, error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}