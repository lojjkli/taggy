/**
 * Player lookup API.
 *
 *   GET /player/<name>           -> profile + tiers
 *   GET /player/<name>?debug=1   -> same, plus per-source status
 *
 * Every source is optional. If one 404s, rate-limits or changes its schema, that
 * source is marked unavailable and the rest still return. Endpoints for the tier
 * sites are guesses in places — use ?debug=1 to see which ones actually answer,
 * then fix the URL in SOURCES below without touching anything else.
 */

import { DurableObject } from "cloudflare:workers";

const CACHE_SECONDS = 900;   // 15 min; these values barely move

/**
 * Registry of players who have run the mod. Clients POST their name once per
 * session; nothing is broadcast, so this never touches the relay rooms and adds
 * no traffic between players.
 */
export class Registry extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS seen (
         name TEXT PRIMARY KEY, display TEXT NOT NULL,
         first INTEGER NOT NULL, last INTEGER NOT NULL, hits INTEGER NOT NULL
       )`);
  }
  async fetch(request) {
    const url = new URL(request.url);

    // list=1 returns everyone seen recently, for the admin "online now" view -
    // separate from the per-name lookup below, which needs a valid username.
    if (url.searchParams.get('list') === '1') {
      const since = parseInt(url.searchParams.get('since') || '0', 10);
      const rows = [...this.ctx.storage.sql.exec(
        `SELECT display AS name, last FROM seen WHERE last > ? ORDER BY last DESC LIMIT 200`, since)];
      return Response.json({ players: rows });
    }

    // display keeps whatever case the player's own client is actually using;
    // name (lowercase) stays the lookup key so "Steve" and "steve" are one row.
    const display = (url.searchParams.get('name') || '').trim();
    const name = display.toLowerCase();
    if (!/^[a-z0-9_]{1,16}$/.test(name)) return new Response('bad name', { status: 400 });
    const now = Date.now();

    if (request.method === 'POST') {
      this.ctx.storage.sql.exec(
        `INSERT INTO seen (name, display, first, last, hits) VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(name) DO UPDATE SET display = ?, last = ?, hits = hits + 1`,
        name, display, now, now, display, now);
      return new Response('ok');
    }
    const rows = [...this.ctx.storage.sql.exec(
      `SELECT display, first, last, hits FROM seen WHERE name = ?`, name)];
    return Response.json(rows.length
      ? { seen: true, name: rows[0].display, firstSeen: rows[0].first,
          lastSeen: rows[0].last, sessions: rows[0].hits }
      : { seen: false });
  }
}

const registry = (env, name) =>
  env.REGISTRY.get(env.REGISTRY.idFromName('global'));

/**
 * Server blacklist. Read is public - every mod install fetches this on join.
 * Write requires the ADMIN_KEY secret, so only whoever set that secret can
 * add or remove a server. Set it once with: wrangler secret put ADMIN_KEY
 */
export class Blacklist extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // kind is 'server' or 'player'; id = kind + ':' + value, so both share one table.
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS blocked (
         id TEXT PRIMARY KEY, kind TEXT NOT NULL, value TEXT NOT NULL, display TEXT NOT NULL,
         reason TEXT, added INTEGER NOT NULL
       )`);
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'GET') {
      const rows = [...this.ctx.storage.sql.exec(`SELECT kind, value, display, reason FROM blocked`)];
      return Response.json({
        servers: rows.filter(r => r.kind === 'server').map(r => r.value),
        players: rows.filter(r => r.kind === 'player').map(r => r.display),
        detail: rows.map(r => ({ kind: r.kind, value: r.value, display: r.display, reason: r.reason })),
      });
    }
    const kind = (url.searchParams.get('kind') || 'server').trim().toLowerCase();
    // display keeps whatever case was typed; value (lowercase) is the actual key,
    // since matching a player or server must never depend on capitalization.
    const displayRaw = (url.searchParams.get('value') || url.searchParams.get('server') || '').trim();
    const value = displayRaw.toLowerCase();
    if (!value || (kind !== 'server' && kind !== 'player')) {
      return new Response('missing or bad value', { status: 400 });
    }
    const id = kind + ':' + value;
    if (request.method === 'POST') {
      const reason = (url.searchParams.get('reason') || '').slice(0, 200);
      this.ctx.storage.sql.exec(
        `INSERT INTO blocked (id, kind, value, display, reason, added) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET display = ?, reason = ?`,
        id, kind, value, displayRaw, reason, Date.now(), displayRaw, reason);
      return new Response('ok');
    }
    if (request.method === 'DELETE') {
      this.ctx.storage.sql.exec(`DELETE FROM blocked WHERE id = ?`, id);
      return new Response('ok');
    }
    return new Response('method not allowed', { status: 405 });
  }
}

const blacklist = (env) => env.BLACKLIST.get(env.BLACKLIST.idFromName('global'));

/**
 * One-shot "get off this server now" signal, separate from the ban list because
 * it is meant to fire once and be done, not accumulate like a blacklist does.
 * The mod polls its own name every ~20s while connected; a timestamp newer than
 * the last one it acted on means disconnect immediately.
 */
export class Kicks extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS kicks (name TEXT PRIMARY KEY, at INTEGER NOT NULL)`);
  }
  async fetch(request) {
    const url = new URL(request.url);
    const name = (url.searchParams.get('name') || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{1,16}$/.test(name)) return new Response('bad name', { status: 400 });

    if (request.method === 'POST') {
      this.ctx.storage.sql.exec(
        `INSERT INTO kicks (name, at) VALUES (?, ?)
         ON CONFLICT(name) DO UPDATE SET at = ?`, name, Date.now(), Date.now());
      return new Response('ok');
    }
    const rows = [...this.ctx.storage.sql.exec(`SELECT at FROM kicks WHERE name = ?`, name)];
    return Response.json({ at: rows.length ? rows[0].at : 0 });
  }
}

const kicks = (env) => env.KICKS.get(env.KICKS.idFromName('global'));

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), { status, headers: CORS });

async function getJSON(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { 'user-agent': 'KlisTeamMod/1.0 (+https://lojjkli.site)', ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/** Tier sites. Each returns whatever it can; shape is normalised by `pick`. */
const SOURCES = [
  // Documented format: api.yeahjenni.xyz/<list>/player/<ign>
  // Lists it supports: mctiers (mctiers.com), mctiersio, ocetiers.
  { id: 'mctiers',  url: (u, n) => `https://api.yeahjenni.xyz/mctiers/player/${n}`,   pick: aggregator },
  { id: 'mctiersio',url: (u, n) => `https://api.yeahjenni.xyz/mctiersio/player/${n}`, pick: aggregator },
  { id: 'ocetiers', url: (u, n) => `https://api.yeahjenni.xyz/ocetiers/player/${n}`,  pick: aggregator },

  // Direct, in case the aggregator is down.
  { id: 'mctiers_direct', url: (u) => `https://mctiers.com/api/profile/${u}`,
    pick: (d) => ({ overall: d.overall ?? null, points: d.points ?? null, modes: d.rankings ?? null }) },

  // Same aggregator, other list names. It uses one URL shape for every list it
  // supports, so if it covers these they work immediately; if not they 404 and
  // the row is simply marked unavailable. Costs nothing to try.
  { id: 'subtiers',  url: (u, n) => `https://api.yeahjenni.xyz/subtiers/player/${n}`,  pick: aggregator },
  { id: 'pvptiers',  url: (u, n) => `https://api.yeahjenni.xyz/pvptiers/player/${n}`,  pick: aggregator },

  // Real endpoints, taken from the TierTagger mod jar: base /api with
  // /profile/<uuid> and /profile/by-name/<name>. by-name avoids any uuid
  // formatting mismatch, so it is tried first.
  { id: 'subtiers_byname', url: (u, n) => `https://subtiers.net/api/profile/by-name/${n}`, pick: passthrough },
  { id: 'subtiers_direct', url: (u) => `https://subtiers.net/api/profile/${u}`,            pick: passthrough },
  { id: 'mctiers_byname',  url: (u, n) => `https://mctiers.com/api/profile/by-name/${n}`,  pick: passthrough },
  // confirmed from the Tiers mod jar
  { id: 'pvptiers',        url: (u) => `https://pvptiers.com/api/profile/${u}`,            pick: passthrough },

  // MCPVP: no endpoint found in either tier mod, so these are candidates derived
  // from the public profile URL (mcpvp.com/profile/<name>). Check ?debug=1 - the
  // one that answers is the keeper, delete the rest.
  { id: 'mcpvp',        url: (u, n) => `https://www.mcpvp.com/api/profile/${n}`,  pick: passthrough },
  { id: 'mcpvp_alt',    url: (u, n) => `https://mcpvp.com/api/profile/${n}`,      pick: passthrough },
  { id: 'mcpvp_uuid',   url: (u) => `https://www.mcpvp.com/api/profile/${u}`,     pick: passthrough },
  { id: 'mcpvp_player', url: (u, n) => `https://www.mcpvp.com/api/player/${n}`,   pick: passthrough },
];

/** api.yeahjenni.xyz shape: gameModes.<mode>.{tier,isLT}, plus tier/score/ranked. */
function aggregator(d) {
  return {
    tier: d.tier ?? null,
    ranked: d.ranked ?? null,
    score: d.score ?? null,
    position: d.leaderboardPosition ?? null,
    modes: d.gameModes ?? null,
  };
}

/**
 * Shape used by mctiers and subtiers, confirmed from TierTagger: the response has
 * `rankings` keyed by gamemode, each { tier, pos, attained, retired, peak }, plus
 * `overall`, `points` and `region` at the top. `pos` 0 means high tier.
 */
function passthrough(d) {
  const modes = d.rankings ?? d.gamemodes ?? d.gameModes ?? d.kitRanks ?? null;
  return {
    overall: d.overall ?? null,
    points: d.points ?? null,
    region: d.region ?? null,
    modes,
    raw: modes ? undefined : d,   // keep the body only when nothing was recognised
  };
}


/**
 * Resolve a name to a UUID. Mojang rate limits and sometimes blocks datacenter
 * IPs outright, and Workers run from datacenters, so fall back to mirrors rather
 * than reporting a live account as nonexistent.
 */
async function resolveName(name, status) {
  const attempts = [
    ['mojang',   `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`,
                 (d) => (d && d.id ? { uuid: d.id, name: d.name } : null)],
    ['playerdb', `https://playerdb.co/api/player/minecraft/${encodeURIComponent(name)}`,
                 (d) => (d && d.data && d.data.player
                          ? { uuid: String(d.data.player.raw_id || d.data.player.id).replace(/-/g, ''),
                              name: d.data.player.username } : null)],
    ['minetools', `https://api.minetools.eu/uuid/${encodeURIComponent(name)}`,
                 (d) => (d && d.id ? { uuid: d.id, name: d.name } : null)],
  ];

  for (const [id, url, parse] of attempts) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'KlisTeamMod/1.0 (+https://lojjkli.site)' } });
      if (r.status === 204 || r.status === 404) { status['resolve_' + id] = 'not found (404)'; continue; }
      if (!r.ok) { status['resolve_' + id] = 'HTTP ' + r.status; continue; }
      const parsed = parse(await r.json());
      if (parsed && parsed.uuid) { status['resolve_' + id] = 'ok'; return parsed; }
      status['resolve_' + id] = 'no uuid in response';
    } catch (e) {
      status['resolve_' + id] = String(e.message);
    }
  }
  return null;
}

async function textures(uuid) {
  const p = await getJSON(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`);
  const prop = (p.properties || []).find((x) => x.name === 'textures');
  if (!prop) return {};
  const decoded = JSON.parse(atob(prop.value));
  const skin = decoded.textures?.SKIN;
  return {
    skin: skin?.url ?? null,
    slim: skin?.metadata?.model === 'slim',
    cape: decoded.textures?.CAPE?.url ?? null,
  };
}

/** laby.net: name history, capes. Path has moved before, so v3 then v2. */
async function laby(uuid) {
  for (const v of ['v3', 'v2']) {
    try {
      const d = await getJSON(`https://laby.net/api/${v}/user/${uuid}/profile`);
      return {
        nameHistory: (d.username_history || d.name_history || []).map((h) => ({
          name: h.username ?? h.name,
          changedAt: h.changed_at ?? h.changedToAt ?? null,
          accurate: h.accurate ?? null,
        })),
        skins: d.skins ?? null,   // present on some versions, null on others
      };
    } catch (e) { /* try the next path */ }
  }
  throw new Error('no laby endpoint answered');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    // clients announce themselves here on startup
    if (url.pathname === '/seen') {
      const name = (url.searchParams.get('name') || '').trim();
      if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) return json({ error: 'bad name' }, 400);
      await registry(env).fetch(new Request(
        `https://r/?name=${encodeURIComponent(name)}`, { method: 'POST' }));
      return json({ ok: true });
    }

    if (url.pathname === '/blacklist') {
      if (request.method === 'GET') {
        const r = await blacklist(env).fetch('https://b/');
        const body = await r.text();
        return new Response(body, { headers: CORS });
      }
      // write: needs the admin key. Case does not matter on either side.
      const key = (request.headers.get('x-admin-key') || url.searchParams.get('key') || '').toLowerCase();
      if (!env.ADMIN_KEY || key !== env.ADMIN_KEY.toLowerCase()) {
        return json({ error: 'unauthorized' }, 401);
      }
      const kind   = url.searchParams.get('kind') || 'server';
      const value  = url.searchParams.get('value') || url.searchParams.get('server') || '';
      const reason = url.searchParams.get('reason') || '';
      const r = await blacklist(env).fetch(
        `https://b/?kind=${encodeURIComponent(kind)}&value=${encodeURIComponent(value)}`
        + `&reason=${encodeURIComponent(reason)}`,
        { method: request.method });
      return json({ ok: r.ok });
    }

    if (url.pathname === '/kick') {
      const name = (url.searchParams.get('name') || '').trim();
      if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) return json({ error: 'bad name' }, 400);

      if (request.method === 'GET') {
        const r = await kicks(env).fetch(`https://k/?name=${encodeURIComponent(name)}`);
        const body = await r.text();
        return new Response(body, { headers: CORS });
      }
      const key = (request.headers.get('x-admin-key') || url.searchParams.get('key') || '').toLowerCase();
      if (!env.ADMIN_KEY || key !== env.ADMIN_KEY.toLowerCase()) {
        return json({ error: 'unauthorized' }, 401);
      }
      const r = await kicks(env).fetch(`https://k/?name=${encodeURIComponent(name)}`, { method: 'POST' });
      return json({ ok: r.ok });
    }

    // Who has used the mod recently - "online now" is approximate: whichever
    // players' clients have checked in within the window.
    if (url.pathname === '/online') {
      const minutes = Math.max(1, Math.min(60, parseInt(url.searchParams.get('minutes') || '5', 10)));
      const r = await registry(env).fetch(`https://r/?list=1&since=${Date.now() - minutes * 60000}`);
      const body = await r.text();
      return new Response(body, { headers: CORS });
    }

    if (!url.pathname.startsWith('/player/')) {
      return json({ ok: true, usage: '/player/<username> or /seen?name=<username>' });
    }

    const name = decodeURIComponent(url.pathname.slice('/player/'.length)).trim();
    if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) return json({ error: 'bad username' }, 400);

    const debug = url.searchParams.get('debug') === '1';
    const cacheKey = new Request(`https://lookup/${name.toLowerCase()}`, request);
    const cached = await caches.default.match(cacheKey);
    if (cached && !debug) return cached;

    const status = {};
    const profile = await resolveName(name, status);
    if (!profile) {
      // say which lookups failed and how, instead of blaming the username
      return json({ error: 'could not resolve username', name, _status: status }, 404);
    }
    const out = { name: profile.name, uuid: profile.uuid, tiers: {} };

    // skin + cape. sessionserver blocks datacenter IPs the same way the name API
    // does, so fall back to a mirror rather than returning no skin at all.
    try {
      const tex = await textures(profile.uuid);
      Object.assign(out, tex);
      status.mojang_textures = tex.skin ? 'ok' : 'no skin in profile';
    } catch (e) {
      status.mojang_textures = String(e.message);
    }
    // Pre-rendered 3D body shots, so the client doesn't have to build a model.
    out.render3d = `https://visage.surgeplay.com/full/256/${profile.uuid}`;
    out.render3dAlt = `https://render.crafty.gg/3d/full/${profile.uuid}`;

    if (!out.skin) {
      out.skin = `https://crafatar.com/skins/${profile.uuid}`;
      out.skinSource = 'crafatar';
      status.skin_fallback = 'crafatar';
    }

    // name history / skin gallery
    try {
      Object.assign(out, await laby(profile.uuid));
      status.laby = 'ok';
    } catch (e) { status.laby = String(e.message); }

    // tier sites, all in parallel — a slow one shouldn't hold up the rest
    await Promise.all(SOURCES.map(async (src) => {
      try {
        const d = await getJSON(src.url(profile.uuid, encodeURIComponent(profile.name)));
        out.tiers[src.id] = src.pick(d);
        status[src.id] = 'ok';
      } catch (e) {
        out.tiers[src.id] = null;
        status[src.id] = String(e.message);
      }
    }));

    // has this player ever run the mod?
    try {
      const r = await registry(env).fetch(`https://r/?name=${encodeURIComponent(profile.name.toLowerCase())}`);
      out.klisTeamMod = await r.json();
      status.registry = 'ok';
    } catch (e) { status.registry = String(e.message); }

    if (debug) out._status = status;

    const res = json(out);
    res.headers.set('cache-control', `public, max-age=${CACHE_SECONDS}`);
    if (!debug) ctx.waitUntil?.(caches.default.put(cacheKey, res.clone()));
    return res;
  },
};
