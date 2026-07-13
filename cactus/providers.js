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
    // GET - 获取所有数据源
    if (method === 'GET') {
      const result = await env.DB.prepare(`
        SELECT id, name, base_url as url, enabled, priority, proxy_enabled as proxyEnabled
        FROM providers
        ORDER BY priority DESC, name ASC
      `).all();

      return new Response(JSON.stringify({ ok: true, providers: result.results }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // PUT - 更新数据源（启用/停用）
    if (method === 'PUT') {
      const body = await request.json();
      const { id, enabled } = body;

      if (!id) {
        return new Response(JSON.stringify({ error: '缺少 ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      await env.DB.prepare(
        'UPDATE providers SET enabled = ? WHERE id = ?'
      ).bind(enabled ? 1 : 0, id).run();

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // DELETE - 删除数据源
    if (method === 'DELETE') {
      const id = path.split('/').pop();
      if (!id) {
        return new Response(JSON.stringify({ error: '缺少 ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      await env.DB.prepare('DELETE FROM providers WHERE id = ?').bind(id).run();
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: '不支持的请求方法' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}