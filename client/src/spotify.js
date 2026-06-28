const CLIENT_ID = '66327082c48c4cdc89b9683ab178e415';
const SCOPES = 'streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state';

export const getRedirectUri = () => {
  return window.location.origin;
};

function generateRandomString(length) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], "");
}

async function sha256(plain) {
  const encoder = new TextEncoder()
  const data = encoder.encode(plain)
  return window.crypto.subtle.digest('SHA-256', data)
}

function base64encode(input) {
  return btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export const loginWithSpotify = async () => {
  const codeVerifier = generateRandomString(64);
  window.localStorage.setItem('spotify_code_verifier', codeVerifier);
  const hashed = await sha256(codeVerifier);
  const codeChallenge = base64encode(hashed);

  const authUrl = new URL("https://accounts.spotify.com/authorize")
  const params =  {
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    redirect_uri: getRedirectUri(),
  }

  authUrl.search = new URLSearchParams(params).toString();
  window.location.href = authUrl.toString();
}

export const getToken = async (code) => {
  const codeVerifier = localStorage.getItem('spotify_code_verifier');
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: getRedirectUri(),
      code_verifier: codeVerifier,
    }),
  });

  const data = await response.json();
  if (data.access_token) {
    localStorage.setItem('spotify_access_token', data.access_token);
    localStorage.setItem('spotify_refresh_token', data.refresh_token);
    localStorage.setItem('spotify_token_expires_at', Date.now() + data.expires_in * 1000);
    return data.access_token;
  }
  return null;
}

export const refreshToken = async () => {
  const refreshToken = localStorage.getItem('spotify_refresh_token');
  if (!refreshToken) return null;

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }),
  });

  const data = await response.json();
  if (data.access_token) {
    localStorage.setItem('spotify_access_token', data.access_token);
    if (data.refresh_token) {
      localStorage.setItem('spotify_refresh_token', data.refresh_token);
    }
    localStorage.setItem('spotify_token_expires_at', Date.now() + data.expires_in * 1000);
    return data.access_token;
  }
  return null;
}

export const getValidToken = async () => {
  let token = localStorage.getItem('spotify_access_token');
  const expiresAt = localStorage.getItem('spotify_token_expires_at');
  
  if (!token || !expiresAt) return null;

  if (Date.now() > Number(expiresAt) - 60000) { // Refresh 1 minute before expiry
    token = await refreshToken();
  }
  
  return token;
}

export const searchTracks = async (query) => {
  const token = await getValidToken();
  if (!token) return [];

  const response = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=5`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  const data = await response.json();
  return data.tracks ? data.tracks.items : [];
}

export const playTrack = async (trackUri, deviceId = null, positionMs = 0) => {
  const token = await getValidToken();
  if (!token) return;

  const url = deviceId 
    ? `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`
    : 'https://api.spotify.com/v1/me/player/play';

  const body = { uris: [trackUri] };
  if (positionMs > 0) {
    body.position_ms = positionMs;
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    if (errorData?.error?.reason === 'NO_ACTIVE_DEVICE' || response.status === 404) {
      throw new Error('NO_ACTIVE_DEVICE');
    }
    throw new Error('FAILED');
  }
}

export const pausePlayback = async () => {
  const token = await getValidToken();
  if (!token) return;

  await fetch('https://api.spotify.com/v1/me/player/pause', {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
}

export const logoutSpotify = () => {
  localStorage.removeItem('spotify_access_token');
  localStorage.removeItem('spotify_refresh_token');
  localStorage.removeItem('spotify_token_expires_at');
  localStorage.removeItem('spotify_code_verifier');
}
