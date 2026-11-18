'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RegionId } from './data/regions';
import type { OpoWorld } from './opo-world';
import type { TourChat, TourPacket } from './tour-live-types';

export default function TourLive({ world, region }: { world: OpoWorld; region: RegionId }) {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [joined, setJoined] = useState(false);
  const [me, setMe] = useState<{ id: string; name: string } | null>(null);
  const [count, setCount] = useState(0);
  const [failed, setFailed] = useState(false);
  const [messages, setMessages] = useState<TourChat[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const messageList = useRef<HTMLDivElement>(null);
  const chatCooldown = useRef<number | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/tour-live', { method: 'HEAD', cache: 'no-store', signal: controller.signal })
      .then(response => { if (!controller.signal.aborted) setAvailable(response.headers.get('X-Tour-Live') === '1'); })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!joined) return;
    const url = new URL('/tour-live', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('region', region);
    const socket = new WebSocket(url);
    socketRef.current = socket;
    const participants = new Set<string>();
    let lastPose = '';
    const updatePose = () => {
      if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 4096) return;
      const pose = JSON.stringify({ ...world.tourPose(), type: 'pose' });
      if (pose === lastPose) return;
      socket.send(pose);
      lastPose = pose;
    };
    const interval = window.setInterval(updatePose, 100);
    const deadline = window.setTimeout(() => socket.close(), 8000);
    socket.onmessage = event => {
      const packet = JSON.parse(event.data) as TourPacket;
      if (packet.type === 'welcome') {
        window.clearTimeout(deadline);
        setMe({ id: packet.id, name: packet.name });
        for (const peer of packet.peers) {
          participants.add(peer.id);
          world.showPeer(peer);
        }
        updatePose();
      } else if (packet.type === 'peer') {
        participants.add(packet.peer.id);
        world.showPeer(packet.peer);
      } else if (packet.type === 'leave') {
        participants.delete(packet.id);
        world.removePeer(packet.id);
      } else if (packet.type === 'chat') {
        setMessages(current => [...current.slice(-49), packet]);
      }
      if (packet.type !== 'chat') setCount(participants.size + 1);
    };
    socket.onclose = () => {
      setFailed(true);
      leave();
    };
    return () => {
      window.clearTimeout(deadline);
      window.clearInterval(interval);
      window.clearTimeout(chatCooldown.current);
      socket.onclose = socket.onmessage = null;
      socket.close();
      socketRef.current = null;
      world.clearPeers();
    };
  }, [world, region, joined]);

  useEffect(() => {
    if (messageList.current) messageList.current.scrollTop = messageList.current.scrollHeight;
  }, [messages, open]);

  function leave() {
    setJoined(false);
    setMe(null);
    setCount(0);
    setMessages([]);
    setDraft('');
    setSending(false);
  }

  function sendChat(event: FormEvent) {
    event.preventDefault();
    const socket = socketRef.current;
    const text = draft.trim();
    if (!text || sending || socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 4096) return;
    socket.send(JSON.stringify({ type: 'chat', text }));
    setDraft('');
    setSending(true);
    chatCooldown.current = window.setTimeout(() => setSending(false), 850);
  }

  if (!available) return null;
  return <>
    <button className="tour-live-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open}
      aria-controls="tour-live-panel">함께 임장{me ? ` · ${count}명` : ''}</button>
    {open && <aside className="tour-live-panel" id="tour-live-panel" aria-label="함께 임장">
      <header><h2>함께 임장</h2><button aria-label="함께 임장 패널 닫기" onClick={() => setOpen(false)}>×</button></header>
      {failed && <p role="status">연결이 끊겼어요. 다시 입장할 수 있습니다.</p>}
      {!joined && <>
        <p>같은 지역에 입장한 임장객에게 아바타의 위치와 채팅이 표시됩니다.</p>
        <button className="tour-live-primary" onClick={() => { setFailed(false); setJoined(true); }}>함께 임장 입장</button>
      </>}
      {joined && !me && <p role="status">임장 방에 연결 중… <button onClick={leave}>취소</button></p>}
      {me && <>
        <div className="tour-live-roster"><span>{me.name} · 현재 {count}명</span><button onClick={leave}>나가기</button></div>
        <div className="tour-live-messages" role="log" aria-label="임장 채팅" ref={messageList}>
          {messages.map(message => <p key={message.id}><strong>{message.sender === me.id ? '나' : message.name}</strong> {message.text}</p>)}
        </div>
        <form onSubmit={sendChat}>
          <input aria-label="채팅 메시지" value={draft} maxLength={180} onChange={event => setDraft(event.target.value)} />
          <button className="tour-live-primary" disabled={sending || !draft.trim()}>보내기</button>
        </form>
      </>}
    </aside>}
  </>;
}
