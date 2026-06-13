// ── CONFIG — fill these in before deploying ───────────────────────────────────
const DISCORD_CLIENT_ID     = '1511570135188508692';
const DISCORD_CLIENT_SECRET = 'MTUxMTU3MDEzNTE4ODUwODY5Mg.G6GemP.F6y84k9q96nsxUsbTe4rCNFhaQlNV3eDHJOx7o'; // paste your secret here
const REDIRECT_URI          = 'https://steam-proxy.rustinction.workers.dev/discord-callback';
const VOTE_PAGE_URL         = 'https://cart-27.github.io/Skin_Manager/SkinBox_Vote.html';

// ── CORS HEADERS ──────────────────────────────────────────────────────────────
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

  // ── DISCORD OAUTH: redirect to Discord login ──────────────────────────────
  if (url.pathname === '/discord-login') {
    const params = new URLSearchParams({
      client_id:     DISCORD_CLIENT_ID,
      redirect_uri:  REDIRECT_URI,
      response_type: 'code',
      scope:         'identify',
    });
    return Response.redirect('https://discord.com/oauth2/authorize?' + params.toString(), 302);
  }

  // ── DISCORD OAUTH: handle callback from Discord ───────────────────────────
  if (url.pathname === '/discord-callback') {
    const code = url.searchParams.get('code');
    if (!code) {
      return Response.redirect(VOTE_PAGE_URL + '?discord_error=no_code', 302);
    }

    try {
      // Exchange code for access token
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
      if (!tokenData.access_token) throw new Error('No access token');

      // Get user info from Discord
      const userRes = await fetch('https://discord.com/api/users/@me', {
        headers: { 'Authorization': 'Bearer ' + tokenData.access_token },
      });
      const user = await userRes.json();

      // Build display name: username + discriminator if not zero
      const discordName = user.discriminator && user.discriminator !== '0'
        ? user.username + '#' + user.discriminator
        : user.username;

      const discordId = user.id;
      const avatar    = user.avatar
        ? 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png'
        : null;

      // Redirect back to vote page with user info in URL params
      const params = new URLSearchParams({
        discord_name:   discordName,
        discord_id:     discordId,
        discord_avatar: avatar || '',
      });
      return Response.redirect(VOTE_PAGE_URL + '?' + params.toString(), 302);

    } catch (e) {
      return Response.redirect(VOTE_PAGE_URL + '?discord_error=' + encodeURIComponent(e.message), 302);
    }
  }

  // ── IMAGE PROXY: GET /img?url=... ─────────────────────────────────────────
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
      // 1x1 transparent gif fallback
      const pixel = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      const buf   = Uint8Array.from(atob(pixel), c => c.charCodeAt(0));
      return new Response(buf, {
        headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'public, max-age=60', ...CORS }
      });
    }
  }

  // ── STEAM API PROXY: POST with skin IDs ───────────────────────────────────
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
      const data = JSON.parse(text);
      return new Response(JSON.stringify(data), {
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
