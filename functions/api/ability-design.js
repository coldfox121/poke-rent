// 能力设计表的读写接口：数据存在 Pages 项目绑定的 KV（变量名 ABILITY_KV）
function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export async function onRequestGet({ env }) {
  if (!env.ABILITY_KV) return json({ ok: false, error: 'KV_NOT_BOUND' }, 500);
  const raw = await env.ABILITY_KV.get('ability-design');
  let data = null;
  if (raw) { try { data = JSON.parse(raw); } catch (e) { data = null; } }
  return json({ ok: true, data: data });
}

export async function onRequestPost({ request, env }) {
  if (!env.ABILITY_KV) return json({ ok: false, error: 'KV_NOT_BOUND' }, 500);
  const body = await request.json().catch(function () { return null; });
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'BAD_BODY' }, 400);
  const text = JSON.stringify(body);
  if (text.length > 200000) return json({ ok: false, error: 'TOO_LARGE' }, 413);
  const savedAt = new Date().toISOString();
  await env.ABILITY_KV.put('ability-design', JSON.stringify({ savedAt: savedAt, payload: body }));
  return json({ ok: true, savedAt: savedAt });
}
