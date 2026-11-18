CREATE TABLE tour_live_peers (
  id TEXT PRIMARY KEY NOT NULL,
  room TEXT NOT NULL,
  session_hash TEXT NOT NULL UNIQUE,
  pose TEXT,
  seen_at INTEGER NOT NULL,
  chat_at INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX tour_live_peers_room ON tour_live_peers(room, seen_at);
--> statement-breakpoint
CREATE TABLE tour_live_chat (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  room TEXT NOT NULL,
  sender TEXT NOT NULL,
  text TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX tour_live_chat_room ON tour_live_chat(room, seq);
