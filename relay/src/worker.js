/**
 * KlisTeam coordinate relay.
 *
 * A dumb message forwarder. Clients open a WebSocket to
 *
 *     wss://relay.example.com/<roomId>
 *
 * where <roomId> is the SHA-256 of the team key, computed on the client. The
 * relay therefore never learns the team key itself, and if the client also
 * encrypts the payload it never learns any coordinates either — it only sees
 * opaque strings arriving and being fanned out.
 *
 * Deliberately knows nothing about the message format. Adding fields (dimension,
 * server id, encryption) is a client-side change only; this file does not move.
 */

import { DurableObject } from "cloudflare:workers";

const MAX_MESSAGE_BYTES = 2048;   // a position update is ~120 bytes
const MAX_CLIENTS       = 32;     // per room
const MAX_MSGS_PER_SEC  = 10;     // per client, then messages are dropped

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // RFC 6455 makes this value case-insensitive and clients disagree on casing
    // ("websocket" vs "WebSocket"). A strict === here answers the handshake with a
    // plain 200, which the client rejects — and the site looks fine in a browser,
    // so the failure appears to be on the client side.
    const upgrade = (request.headers.get("Upgrade") || "").toLowerCase();
    if (upgrade !== "websocket") {
      // plain GET — useful for checking the deploy actually works
      return new Response("KlisTeam relay online\n", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }

    const room = url.pathname.replace(/^\/+/, "").trim();
    if (!/^[A-Fa-f0-9]{16,64}$/.test(room)) {
      return new Response("bad room id", { status: 400 });
    }

    const id = env.ROOMS.idFromName(room);
    return env.ROOMS.get(id).fetch(request);
  },
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Handled by the runtime without waking the object, so keepalives are free
    // and don't count against the duration budget.
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong")
    );
  }

  async fetch(request) {
    if (this.ctx.getWebSockets().length >= MAX_CLIENTS) {
      return new Response("room full", { status: 429 });
    }

    const [client, server] = Object.values(new WebSocketPair());

    // Hibernation: the object is evicted from memory while idle but the sockets
    // stay open, so an idle team costs nothing.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ windowStart: 0, count: 0, last: null });

    // Replay everyone's most recent frame to the new arrival, so they see the team
    // immediately instead of waiting for each player's next update. Frames are
    // opaque ciphertext here - the relay still understands none of it.
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === server) continue;
      const meta = peer.deserializeAttachment();
      if (meta && meta.last) {
        try { server.send(meta.last); } catch (e) { /* peer gone */ }
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== "string") return;          // no binary
    if (message.length > MAX_MESSAGE_BYTES) {
      ws.close(1009, "message too large");
      return;
    }

    // crude per-socket rate limit so one bad client can't burn the daily quota
    const now = Date.now();
    const meta = ws.deserializeAttachment() || { windowStart: 0, count: 0 };
    if (now - meta.windowStart > 1000) {
      meta.windowStart = now;
      meta.count = 0;
    }
    meta.count++;
    if (message !== 'ping') meta.last = message;   // remembered for late joiners
    ws.serializeAttachment(meta);
    if (meta.count > MAX_MSGS_PER_SEC) return;

    for (const peer of this.ctx.getWebSockets()) {
      if (peer === ws) continue;
      try {
        peer.send(message);
      } catch (e) {
        // peer is gone; the runtime will clean it up
      }
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    try { ws.close(code, "closing"); } catch (e) { /* already closed */ }
  }

  async webSocketError(ws, error) {
    try { ws.close(1011, "error"); } catch (e) { /* already closed */ }
  }
}
