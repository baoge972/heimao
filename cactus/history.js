export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;

  const token = request.headers.get('X-Admin-Token') || url.searchParams.get('token');
  const ADMIN_TOKEN = env.ADMIN_TOKEN;

  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: '未授权' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    if (method === 'GET' && path === '/api/admin/history') {
      const result = await env.DB.prepare(`
        SELECT item_key, payload_json, updated_at
        FROM watch_history
        ORDER BY updated_at DESC
      `).all();

      const items = result.results.map(row => {
        let payload = {};
        try { payload = JSON.parse(row.payload_json); } catch (e) {}
        return {
          key: row.item_key,
          name: payload.name || payload.title || '未命名',
          episodeName: payload.episodeName || payload.episode_name || '',
          position: payload.position || 0,
          duration: payload.duration || 0,
          sourceName: payload.sourceName || payload.source_name || '',
          providerName: payload.providerName || payload.provider_name || '',
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
        };
      });

      return new Response(JSON.stringify({ total: items.length, items }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (method === 'DELETE' && path === '/api/admin/history') {
      const key = url.searchParams.get('key');
      if (key) {
        await env.DB.prepare('DELETE FROM watch_history WHERE item_key = ?').bind(key).run();
        return new Response(JSON.stringify({ success: true, message: '已删除' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        await env.DB.prepare('DELETE FROM watch_history').run();
        return new Response(JSON.stringify({ success: true, message: '已清空全部历史' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response(JSON.stringify({ error: '不支持的请求' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}