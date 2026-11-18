import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import sirv from 'sirv';
import { WebSocket, WebSocketServer } from 'ws';
import { chatCooldown, readChat, readPose, roomCapacity, tourRegions, visitorName } from '../worker/tour-protocol.mjs';

const output = fileURLToPath(new URL('../out/', import.meta.url));
if (!existsSync(new URL('../out/index.html', import.meta.url))) {
  throw new Error('Run npm run build before starting the tour server.');
}

const port = Number(process.env.PORT ?? 4295);
const host = process.env.TOUR_HOST ?? '127.0.0.1';
const origins = new Set((process.env.TOUR_ORIGINS ?? `http://localhost:${port},http://127.0.0.1:${port}`)
  .split(',').map(origin => origin.trim()));
const rooms = new Map(Array.from(tourRegions, region => [region, new Map()]));
const files = sirv(output);
const server = createServer((request, response) => {
  if (request.url === '/tour-live' && request.method === 'HEAD') {
    response.writeHead(204, { 'X-Tour-Live': '1', 'Cache-Control': 'no-store' }).end();
    return;
  }
  files(request, response, () => response.writeHead(404).end('Not found'));
});
const sockets = new WebSocketServer({ noServer: true, maxPayload: 2_048, perMessageDeflate: false });

function send(socket, packet) {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > 64 * 1024) {
    socket.terminate();
    return;
  }
  socket.send(JSON.stringify(packet));
}

function broadcast(room, packet, except) {
  for (const socket of room.keys()) if (socket !== except) send(socket, packet);
}

server.on('upgrade', (request, socket, head) => {
  const room = rooms.get(/^\/tour-live\?region=(opo|songpa)$/.exec(request.url ?? '')?.[1]);
  if (!room || !origins.has(request.headers.origin) || room.size >= roomCapacity) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  sockets.handleUpgrade(request, socket, head, client => {
    const id = randomUUID();
    const name = visitorName(id);
    const peer = { id, name, pose: null };
    room.set(client, peer);
    let lastPose = -Infinity;
    let lastChat = -Infinity;
    let remaining = 40;
    let limitReset = performance.now() + 1000;
    client.isAlive = true;
    client.on('error', () => client.terminate());
    client.on('pong', () => { client.isAlive = true; });
    client.on('close', () => {
      room.delete(client);
      broadcast(room, { type: 'leave', id });
    });
    client.on('message', (payload, binary) => {
      const now = performance.now();
      if (now >= limitReset) { limitReset = now + 1000; remaining = 40; }
      if (binary || --remaining < 0) { client.close(1008); return; }
      let message;
      try { message = JSON.parse(payload.toString()); } catch { return; }
      if (!message || typeof message !== 'object') return;
      if (message.type === 'pose' && now - lastPose >= 75) {
        const pose = readPose(message);
        if (!pose) return;
        peer.pose = pose;
        lastPose = now;
        broadcast(room, { type: 'peer', peer }, client);
      }
      if (message.type === 'chat' && now - lastChat >= chatCooldown) {
        const text = readChat(message.text);
        if (!text) return;
        lastChat = now;
        broadcast(room, { type: 'chat', id: randomUUID(), sender: id, name, text });
      }
    });
    send(client, { type: 'welcome', id, name, peers: [...room.values()].filter(other => other.id !== id) });
    broadcast(room, { type: 'peer', peer }, client);
  });
});

const heartbeat = setInterval(() => {
  for (const room of rooms.values()) for (const socket of room.keys()) {
    if (!socket.isAlive) { socket.terminate(); continue; }
    socket.isAlive = false;
    socket.ping();
  }
}, 15_000);
heartbeat.unref();
server.listen(port, host, () => console.log(`Tour server listening on http://${host}:${port}`));
