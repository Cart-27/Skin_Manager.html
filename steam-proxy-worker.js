// ── CONFIG ────────────────────────────────────────────────────────────────────
// DISCORD_CLIENT_SECRET is stored as a Cloudflare environment variable
// Set it by running: wrangler secret put DISCORD_CLIENT_SECRET
// Never put the actual secret in this file.

const DISCORD_CLIENT_ID = '1515464797523546313';
const REDIRECT_URI      = 'https://steam-proxy.rustinction.workers.dev/discord-callback';
const VOTE_PAGE_URL     = 'https://cart-27.github.io/Skin_Manager/SkinBox_Vote.html';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': '*',
  'Access-Control-Allow-Headers': '*',
};

addEventListener('fetch', event => {
  event.respondWith(handle(event.request));
});

async function handle(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(req.url);

  // ── DISCORD LOGIN: redirect player to Discord ─────────────────────────────
  if (url.pathname === '/discord-login') {
    const params = new URLSearchParams({
      client_id:     DISCORD_CLIENT_ID,
      redirect_uri:  REDIRECT_URI,
      response_type: 'code',
      scope:         'identify',
    });
    return Response.redirect('https://discord.com/oauth2/authorize?' + params.toString(), 302);
  }

  // ── DISCORD CALLBACK: exchange code for user info ─────────────────────────
  if (url.pathname === '/discord-callback') {
    const code = url.searchParams.get('code');
    if (!code) {
      return Response.redirect(VOTE_PAGE_URL + '?discord_error=no_code', 302);
    }
    try {
      // DISCORD_CLIENT_SECRET comes from Cloudflare environment variable
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     DISCORD_CLIENT_ID,
          client_secret: DISCORD_CLIENT_SECRET,
          grant_type:    'authorization_code',
          code,
          redirect_uri:  REDIRECT_URI,
        }).toString(),
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) throw new Error('No access token — Discord said: ' + JSON.stringify(tokenData));

      const userRes = await fetch('https://discord.com/api/users/@me', {
        headers: { 'Authorization': 'Bearer ' + tokenData.access_token },
      });
      const user = await userRes.json();

      const discordName = user.discriminator && user.discriminator !== '0'
        ? user.username + '#' + user.discriminator
        : user.username;

      const avatar = user.avatar
        ? 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png'
        : '';

      const params = new URLSearchParams({
        discord_name:   discordName,
        discord_id:     user.id,
        discord_avatar: avatar,
      });
      return Response.redirect(VOTE_PAGE_URL + '?' + params.toString(), 302);
    } catch (e) {
      return Response.redirect(VOTE_PAGE_URL + '?discord_error=' + encodeURIComponent(e.message), 302);
    }
  }

  // ── IMAGE PROXY: GET ?url=... ─────────────────────────────────────────────
  if (req.method === 'GET' && url.searchParams.has('url')) {
    const imgUrl = url.searchParams.get('url');
    try {
      const r = await fetch(imgUrl, {
        headers: {
          'Referer':    'https://steamcommunity.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        }
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.arrayBuffer();
      return new Response(blob, {
        headers: {
          'Content-Type':  r.headers.get('Content-Type') || 'image/jpeg',
          'Cache-Control': 'public, max-age=604800',
          ...CORS
        }
      });
    } catch (e) {
      const pixel = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      const buf   = Uint8Array.from(atob(pixel), c => c.charCodeAt(0));
      return new Response(buf, {
        headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'public, max-age=60', ...CORS }
      });
    }
  }

  // ── STEAM API PROXY: POST ─────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return new Response('Steam proxy is running OK', { status: 200, headers: CORS });
  }

  try {
    const body = await req.text();
    const r    = await fetch(
      'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
      {
        method:  'POST',
        body,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent':   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Origin':       'https://steamcommunity.com',
          'Referer':      'https://steamcommunity.com/',
        }
      }
    );
    const text = await r.text();
    try {
      return new Response(JSON.parse(text) && text, {
        headers: { 'Content-Type': 'application/json', ...CORS }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Steam returned non-JSON', body: text.substring(0, 200) }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...CORS }
      });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS }
    });
  }
}
