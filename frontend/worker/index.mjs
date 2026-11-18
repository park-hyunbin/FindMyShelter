import { chatCooldown, readChat, readPose, roomCapacity, tourRegions, visitorName } from './tour-protocol.mjs';

const leaseMs = 25_000;
const chatLifetimeMs = 10 * 60_000;
const sessionHeader = /^Bearer ([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
const apiHeaders = { 'Cache-Control': 'no-store' };

function json(data, status = 200) {
  return Response.json(data, { status, headers: apiHeaders });
}

async function body(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json') || !request.body) return;
  const reader = request.body.getReader();
  const data = new Uint8Array(1024);
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return JSON.parse(new TextDecoder().decode(data.subarray(0, size)));
      if (size + chunk.value.length > data.length) { await reader.cancel(); return; }
      data.set(chunk.value, size);
      size += chunk.value.length;
    }
  } catch {
    return;
  } finally {
    reader.releaseLock();
  }
}

async function hash(token) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

function livePeers(db, room, id, now) {
  return db.prepare('SELECT id, pose FROM tour_live_peers WHERE room = ? AND seen_at > ? AND id != ? ORDER BY id LIMIT ?')
    .bind(room, now - leaseMs, id, roomCapacity);
}

function peerPackets(rows) {
  return rows.map(row => ({ id: row.id, name: visitorName(row.id), pose: row.pose ? JSON.parse(row.pose) : null }));
}

async function join(db, room, position, now) {
  const id = crypto.randomUUID(), session = crypto.randomUUID();
  const results = await db.batch([
    db.prepare('DELETE FROM tour_live_peers WHERE room = ? AND seen_at <= ?').bind(room, now - leaseMs),
    db.prepare('DELETE FROM tour_live_chat WHERE sent_at <= ?').bind(now - chatLifetimeMs),
    db.prepare(`INSERT INTO tour_live_peers (id, room, session_hash, pose, seen_at)
      SELECT ?, ?, ?, ?, ? WHERE (SELECT count(*) FROM tour_live_peers WHERE room = ?) < ?`)
      .bind(id, room, await hash(session), JSON.stringify(position), now, room, roomCapacity),
    livePeers(db, room, id, now),
    db.prepare('SELECT COALESCE(MAX(seq), 0) AS cursor FROM tour_live_chat WHERE room = ?').bind(room),
  ]);
  if (!results[2].meta.changes) return json({ error: 'room-full' }, 409);
  return json({ id, name: visitorName(id), session, peers: peerPackets(results[3].results), cursor: results[4].results[0].cursor });
}

async function exchange(db, room, request, data, now) {
  const token = sessionHeader.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (!token) return json({ error: 'session-required' }, 401);
  const session = await hash(token);
  const peer = await db.prepare('SELECT id, pose, seen_at FROM tour_live_peers WHERE session_hash = ? AND room = ? AND seen_at > ?')
    .bind(session, room, now - leaseMs).first();
  if (!peer) return json({ error: 'session-expired' }, 401);
  if (data.type === 'leave') {
    await db.prepare('DELETE FROM tour_live_peers WHERE session_hash = ? AND room = ?').bind(session, room).run();
    return new Response(null, { status: 204, headers: apiHeaders });
  }
  const pose = readPose(data.pose);
  const text = readChat(data.chat);
  const cursor = data.cursor;
  if (data.type !== 'sync' || !pose || !Number.isSafeInteger(cursor) || cursor < 0
    || (data.chat !== undefined && !text)) return json({ error: 'invalid-update' }, 400);
  const nextPose = JSON.stringify(pose);
  const statements = [];
  if (now - peer.seen_at >= 5_000 || (nextPose !== peer.pose && now - peer.seen_at >= 350)) {
    statements.push(db.prepare(`UPDATE tour_live_peers SET pose = ?, seen_at = ?
      WHERE session_hash = ? AND seen_at <= ?`).bind(nextPose, now, session, now - 350));
  }
  if (text) {
    // A D1 batch serializes the insert and cooldown update across Worker instances.
    statements.push(db.prepare(`INSERT INTO tour_live_chat (room, sender, text, sent_at)
      SELECT room, id, ?, ? FROM tour_live_peers WHERE session_hash = ? AND chat_at <= ?`)
      .bind(text, now, session, now - chatCooldown));
    statements.push(db.prepare('UPDATE tour_live_peers SET chat_at = ? WHERE session_hash = ? AND chat_at <= ?')
      .bind(now, session, now - chatCooldown));
  }
  const offset = statements.length;
  statements.push(livePeers(db, room, peer.id, now));
  statements.push(db.prepare(`SELECT seq, sender, text FROM tour_live_chat
    WHERE room = ? AND seq > ? AND sent_at > ? ORDER BY seq LIMIT 40`).bind(room, cursor, now - chatLifetimeMs));
  const results = await db.batch(statements);
  const rows = results[offset + 1].results;
  return json({
    peers: peerPackets(results[offset].results),
    messages: rows.map(row => ({ type: 'chat', id: String(row.seq), sender: row.sender, name: visitorName(row.sender), text: row.text })),
    cursor: rows.at(-1)?.seq ?? cursor,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/tour-live') return env.ASSETS.fetch(request);
    if (request.method === 'HEAD') {
      const headers = env.DB ? { ...apiHeaders, 'X-Tour-Live': 'poll' } : apiHeaders;
      return new Response(null, { status: env.DB ? 204 : 503, headers });
    }
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...apiHeaders, Allow: 'HEAD, POST' } });
    if (request.headers.get('Origin') !== url.origin) return json({ error: 'origin' }, 403);
    const room = url.searchParams.get('region');
    if (!tourRegions.has(room)) return json({ error: 'region' }, 404);
    if (!env.DB) return json({ error: 'unavailable' }, 503);
    const data = await body(request);
    if (!data || typeof data !== 'object') return json({ error: 'invalid-body' }, 400);
    try {
      const now = Date.now();
      if (data.type !== 'join') return await exchange(env.DB, room, request, data, now);
      const position = readPose(data.pose);
      return position ? await join(env.DB, room, position, now) : json({ error: 'invalid-position' }, 400);
    } catch (error) {
      console.error('Live tour exchange failed', error);
      return json({ error: 'unavailable' }, 503);
    }
  },
};
