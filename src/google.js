// Login con Google por OAuth 2.0 (flujo con código + PKCE), sin librerías y sin JavaScript en el navegador.
const URL_AUTORIZACION = 'https://accounts.google.com/o/oauth2/v2/auth';
const URL_TOKEN = 'https://oauth2.googleapis.com/token';
const EMISORES = ['https://accounts.google.com', 'accounts.google.com'];

export function crearGoogle({ clientId, clientSecret }) {
  return {
    urlAutorizacion({ redirectUri, state, codeChallenge }) {
      const url = new URL(URL_AUTORIZACION);
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      return url.toString();
    },

    async canjearCodigo({ code, redirectUri, codeVerifier }) {
      const r = await fetch(URL_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: codeVerifier,
        }),
      });
      if (!r.ok) throw new Error(`Google respondió ${r.status}: ${await r.text()}`);
      const { id_token: idToken } = await r.json();

      // No se verifica la firma: el token llega directo de Google, por TLS y a cambio del client
      // secret (OpenID Connect Core 3.1.3.7). Sí se validan emisor, destinatario y vencimiento.
      const datos = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
      if (!EMISORES.includes(datos.iss)) throw new Error(`Emisor inesperado: ${datos.iss}`);
      if (datos.aud !== clientId) throw new Error('El token es para otra aplicación');
      if (datos.exp * 1000 < Date.now()) throw new Error('Token vencido');

      return { sub: datos.sub, email: datos.email_verified ? datos.email : null };
    },
  };
}
