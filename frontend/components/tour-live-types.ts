export type TourPose = { x: number; z: number; heading: number; driving: boolean };
export type TourPeer = { id: string; name: string; pose: TourPose | null };
export type TourChat = { type: 'chat'; id: string; sender: string; name: string; text: string };
export type TourPacket =
  | { type: 'welcome'; id: string; name: string; peers: TourPeer[] }
  | { type: 'peer'; peer: TourPeer }
  | { type: 'leave'; id: string }
  | TourChat;
