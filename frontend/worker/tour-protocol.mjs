export const roomCapacity = 24;
export const chatCooldown = 850;
export const tourRegions = new Set(['opo', 'songpa']);

export function visitorName(id) {
  return `임장객 ${id.slice(0, 6).toUpperCase()}`;
}

export function readPose(message) {
  if (!message || typeof message !== 'object') return;
  const { x, z, heading, driving } = message;
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 1250 || Math.abs(z) > 1250
      || !Number.isFinite(heading) || Math.abs(heading) > 2 * Math.PI || typeof driving !== 'boolean') return;
  return { x, z, heading, driving };
}

export function readChat(value) {
  if (typeof value !== 'string') return;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return text.length && text.length <= 180 ? text : undefined;
}
