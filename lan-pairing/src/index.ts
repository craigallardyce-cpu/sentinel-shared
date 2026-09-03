/**
 * LAN pairing auth for the fleet's on-boat backends.
 *
 * Both desktop apps run an Express server bound to 0.0.0.0 so a phone or tablet
 * aboard can reach it. That is the feature. What it also did, until this module,
 * was answer anything else on the same network: marina Wi-Fi is a shared LAN,
 * and a boat's own network carries guest phones, crew devices and instruments.
 * CORS constrains browser contexts only -- curl, or any app, ignores it.
 *
 * The model:
 *
 *   - Requests from the machine itself (loopback) pass untouched. That is the
 *     Electron shell and the desktop UI it serves, which is already inside the
 *     trust boundary: it can read the token file directly.
 *   - Anything arriving over the network presents the pairing token, which the
 *     backend mints once and keeps.
 *
 * Nobody types that token. The desktop reads it over loopback at startup and
 * publishes it to the vessel layer of `@sentinel/settings`, so every device
 * signed into the account receives it with the rest of its settings. Rotating
 * it -- deleting the file and restarting -- reaches every paired device by the
 * same route, which reading it aloud across a cabin never did.
 *
 * The token rides either the `X-Sentinel-Token` header or a `token` query
 * parameter. The query form is not laziness: EventSource, WebSocket upgrades and
 * `<audio>` elements cannot set headers, and the fleet uses all three.
 *
 * OceanSentinel had this first, as `backend/utils/lanAuth.js`. HarborSentinel had
 * nothing at all, which is the drift this package closes: one implementation, one
 * token file format, one 401.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * The shape this module needs from an incoming request.
 *
 * Structural rather than `express.Request` so the package carries no dependency
 * on express or its types, and so the WebSocket upgrade handler -- which is
 * handed a bare `http.IncomingMessage` -- can be checked by the same function.
 */
export interface PairingRequest {
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | null } | null;
}

export interface LanPairingOptions {
  /**
   * Absolute path of the token file, `{ token, createdAt }` as JSON.
   *
   * The caller decides where, because the two apps keep their state in different
   * places and both must survive an update: OceanSentinel writes it beside its
   * database under the Electron user-data path, HarborSentinel beside its own.
   */
  tokenFile: string;
}

export interface LanPairing {
  getPairingToken(): string;
  isAuthorizedRequest(req: PairingRequest): boolean;
  lanAuthGuard(req: PairingRequest, res: any, next: () => void): void;
  pairingTokenHandler(req: PairingRequest, res: any): void;
}

/**
 * Whether an address is this machine talking to itself.
 *
 * `::ffff:127.x` is the IPv4-mapped form Node reports on a dual-stack listener,
 * and leaving it out means the desktop app fails to authenticate against its own
 * backend on exactly the platforms that use it.
 */
export function isLoopbackAddress(address: string | null | undefined): boolean {
  const addr = String(address || '');
  return addr === '::1' || addr.startsWith('127.') || addr.startsWith('::ffff:127.');
}

/** Constant-time compare, so a wrong token cannot be found one character at a time. */
function timingSafeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** The `token` query parameter, without pulling in the legacy url module. */
function queryToken(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  try {
    // The URL is relative -- and inside a mounted middleware it has had the mount
    // path stripped -- so it needs a base it will never be used against.
    return new URL(rawUrl, 'http://lan-pairing.invalid').searchParams.get('token');
  } catch {
    return null;
  }
}

export function createLanPairing({ tokenFile }: LanPairingOptions): LanPairing {
  let cachedToken: string | null = null;

  /** The persistent pairing token, minted on first use. Survives restarts and updates. */
  function getPairingToken(): string {
    if (cachedToken) return cachedToken;

    try {
      if (fs.existsSync(tokenFile)) {
        const stored = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
        const token: unknown = stored?.token;
        if (typeof token === 'string' && token.length >= 8) {
          cachedToken = token;
          return token;
        }
      }
    } catch (err: any) {
      console.warn('[LAN Auth] Could not read pairing token file, minting a new one:', err?.message ?? err);
    }

    // 8 hex pairs, grouped. The grouping is a holdover from when somebody had to
    // read it across a cabin; it costs nothing and it still helps when the token
    // has to be compared against what a device is presenting.
    const raw = crypto.randomBytes(8).toString('hex').toUpperCase();
    const minted = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`;
    cachedToken = minted;

    try {
      const dir = path.dirname(tokenFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        tokenFile,
        JSON.stringify({ token: minted, createdAt: new Date().toISOString() }, null, 2),
        'utf8'
      );
    } catch (err: any) {
      console.error('[LAN Auth] Could not persist pairing token (it will rotate on restart):', err?.message ?? err);
    }

    return minted;
  }

  /** Shared by the Express guard and the WebSocket upgrade handler. */
  function isAuthorizedRequest(req: PairingRequest): boolean {
    if (isLoopbackAddress(req.socket?.remoteAddress)) return true;

    const headerToken = req.headers?.['x-sentinel-token'];
    const presented = (Array.isArray(headerToken) ? headerToken[0] : headerToken) || queryToken(req.url);

    return !!presented && timingSafeEquals(presented, getPairingToken());
  }

  /** Express middleware for the API and any other namespace worth protecting. */
  function lanAuthGuard(req: PairingRequest, res: any, next: () => void): void {
    if (isAuthorizedRequest(req)) return next();

    res.status(401).json({
      error: 'Pairing token required',
      hint:
        'Sign in on this device with the account the desktop app uses. It publishes its pairing ' +
        'token to your boat record, and devices on that account receive it with the rest of ' +
        'their settings — there is nothing to type.',
    });
  }

  /**
   * The token, for the machine that owns it.
   *
   * Loopback only, and that is load-bearing: this endpoint is how the desktop
   * learns its own token in order to publish it, and serving it over the LAN
   * would hand the credential to exactly the devices the guard exists to stop.
   */
  function pairingTokenHandler(req: PairingRequest, res: any): void {
    if (!isLoopbackAddress(req.socket?.remoteAddress)) {
      res.status(403).json({ error: 'Only readable on the machine running the server.' });
      return;
    }
    res.json({ token: getPairingToken() });
  }

  return { getPairingToken, isAuthorizedRequest, lanAuthGuard, pairingTokenHandler };
}
