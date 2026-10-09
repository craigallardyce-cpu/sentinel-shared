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
 *   - Requests from the machine itself (loopback) pass untouched, provided
 *     their Host header names the machine too (`localhost`, `127.0.0.1` or
 *     `[::1]`, any port). That is the Electron shell and the desktop UI it
 *     serves, which is already inside the trust boundary: it can read the token
 *     file directly. The Host check is what stops DNS rebinding: a web page on
 *     some other site whose name has been re-pointed at 127.0.0.1 arrives over
 *     loopback, but with that site's name in Host, so it is treated as LAN.
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
 * Whether an address is this machine talking to itself.
 *
 * `::ffff:127.x` is the IPv4-mapped form Node reports on a dual-stack listener,
 * and leaving it out means the desktop app fails to authenticate against its own
 * backend on exactly the platforms that use it.
 */
export function isLoopbackAddress(address) {
    const addr = String(address || '');
    return addr === '::1' || addr.startsWith('127.') || addr.startsWith('::ffff:127.');
}
/**
 * Whether a Host header names this machine: `localhost`, `127.0.0.1` or
 * `[::1]`, case-insensitive, with or without a port.
 *
 * Absent counts as not local. HTTP/1.1 requires the header, so a request
 * without one is not the desktop UI, which always sends it.
 */
function isLocalHostHeader(value) {
    const raw = Array.isArray(value) ? value[0] : value;
    if (!raw)
        return false;
    let name = String(raw).trim().toLowerCase();
    if (name.startsWith('[')) {
        const end = name.indexOf(']');
        if (end === -1 || !/^(:\d*)?$/.test(name.slice(end + 1)))
            return false;
        name = name.slice(0, end + 1);
    }
    else {
        const colon = name.indexOf(':');
        if (colon !== -1) {
            if (!/^\d*$/.test(name.slice(colon + 1)))
                return false;
            name = name.slice(0, colon);
        }
    }
    return name === 'localhost' || name === '127.0.0.1' || name === '[::1]';
}
/** Loopback socket and a local Host header: the machine talking to itself. */
function isLocalRequest(req) {
    return isLoopbackAddress(req.socket?.remoteAddress) && isLocalHostHeader(req.headers?.host);
}
/** Constant-time compare, so a wrong token cannot be found one character at a time. */
function timingSafeEquals(a, b) {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
/** The `token` query parameter, without pulling in the legacy url module. */
function queryToken(rawUrl) {
    if (!rawUrl)
        return null;
    try {
        // The URL is relative -- and inside a mounted middleware it has had the mount
        // path stripped -- so it needs a base it will never be used against.
        return new URL(rawUrl, 'http://lan-pairing.invalid').searchParams.get('token');
    }
    catch {
        return null;
    }
}
export function createLanPairing({ tokenFile }) {
    let cachedToken = null;
    /** The persistent pairing token, minted on first use. Survives restarts and updates. */
    function getPairingToken() {
        if (cachedToken)
            return cachedToken;
        try {
            if (fs.existsSync(tokenFile)) {
                const stored = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
                const token = stored?.token;
                if (typeof token === 'string' && token.length >= 8) {
                    cachedToken = token;
                    return token;
                }
            }
        }
        catch (err) {
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
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            // Written beside the target and renamed over it, so a crash or a second
            // process reading mid-write never sees a half-written file (which would
            // fail to parse and mint a different token, unpairing every device).
            const tmpFile = `${tokenFile}.${process.pid}.tmp`;
            fs.writeFileSync(tmpFile, JSON.stringify({ token: minted, createdAt: new Date().toISOString() }, null, 2), 'utf8');
            fs.renameSync(tmpFile, tokenFile);
        }
        catch (err) {
            console.error('[LAN Auth] Could not persist pairing token (it will rotate on restart):', err?.message ?? err);
        }
        return minted;
    }
    /** Shared by the Express guard and the WebSocket upgrade handler. */
    function isAuthorizedRequest(req) {
        if (isLocalRequest(req))
            return true;
        const headerToken = req.headers?.['x-sentinel-token'];
        const presented = (Array.isArray(headerToken) ? headerToken[0] : headerToken) || queryToken(req.url);
        return !!presented && timingSafeEquals(presented, getPairingToken());
    }
    /** Express middleware for the API and any other namespace worth protecting. */
    function lanAuthGuard(req, res, next) {
        if (isAuthorizedRequest(req))
            return next();
        res.status(401).json({
            error: 'Pairing token required',
            hint: 'Sign in on this device with the account the desktop app uses. It publishes its pairing ' +
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
    function pairingTokenHandler(req, res) {
        if (!isLocalRequest(req)) {
            res.status(403).json({ error: 'Only readable on the machine running the server.' });
            return;
        }
        res.json({ token: getPairingToken() });
    }
    return { getPairingToken, isAuthorizedRequest, lanAuthGuard, pairingTokenHandler };
}
