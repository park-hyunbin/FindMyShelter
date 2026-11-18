import type { TourChat, TourPacket, TourPeer, TourPose } from './tour-live-types';

type Joined = { id: string; name: string; session: string; peers: TourPeer[]; cursor: number };
type Snapshot = { peers: TourPeer[]; messages: TourChat[]; cursor: number };

export function openLiveTourHttp(url: URL, position: () => TourPose, onPacket: (packet: TourPacket) => void, onFailure: () => void) {
  let active = true, session = '', cursor = 0, errors = 0;
  let timer: number | undefined, pending: string | undefined, nextChatAt = 0;
  let peers = new Map<string, TourPeer>();

  function request(data: object, bearer = '', keepalive = false) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    return fetch(url, { method: 'POST', headers, body: JSON.stringify(data), keepalive, signal: AbortSignal.timeout(7000) });
  }

  function leave(token: string) {
    if (token) void request({ type: 'leave' }, token, true).catch(() => {});
  }

  async function sync() {
    if (!active) return;
    const chat = Date.now() >= nextChatAt ? pending : undefined;
    if (chat !== undefined) pending = undefined;
    try {
      const response = await request({ type: 'sync', pose: position(), cursor, chat }, session);
      if (!active) return;
      if (response.status === 401) { onFailure(); return; }
      if (!response.ok) throw new Error('Live tour update failed');
      if (chat !== undefined) nextChatAt = Date.now() + 850;
      const snapshot: Snapshot = await response.json();
      if (!active) return;
      cursor = snapshot.cursor;
      const current = new Map(snapshot.peers.map(peer => [peer.id, peer]));
      for (const [id] of peers) if (!current.has(id)) onPacket({ type: 'leave', id });
      for (const [id, peer] of current) {
        const last = peers.get(id);
        if (!last || JSON.stringify(last.pose) !== JSON.stringify(peer.pose)) onPacket({ type: 'peer', peer });
      }
      peers = current;
      snapshot.messages.forEach(onPacket);
      errors = 0;
    } catch {
      if (!active) return;
      if (++errors >= 3) { onFailure(); return; }
    }
    if (active) timer = window.setTimeout(sync, peers.size || pending ? 480 : 950);
  }

  void request({ type: 'join', pose: position() }).then(async response => {
    if (!response.ok) throw new Error('Live tour join failed');
    const joined: Joined = await response.json();
    if (!active) { leave(joined.session); return; }
    session = joined.session;
    cursor = joined.cursor;
    peers = new Map(joined.peers.map(peer => [peer.id, peer]));
    onPacket({ type: 'welcome', id: joined.id, name: joined.name, peers: joined.peers });
    void sync();
  }).catch(() => { if (active) onFailure(); });

  return {
    sendChat(text: string) {
      if (!active || !session || pending !== undefined) return false;
      pending = text;
      return true;
    },
    dispose() {
      active = false;
      window.clearTimeout(timer);
      leave(session);
    },
  };
}
