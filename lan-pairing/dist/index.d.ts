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
    socket?: {
        remoteAddress?: string | null;
    } | null;
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
export declare function isLoopbackAddress(address: string | null | undefined): boolean;
/**
 * Whether a browser says this request was made by a page from somewhere else.
 *
 * Loopback and a local Host header are not enough to be "the machine talking
 * to itself": a page from any website, open in a browser on the boat PC, can
 * send a request to `http://localhost:3000` and it arrives exactly that way.
 * CORS stops that page reading the answer, not the request being carried out,
 * and a request that ends an anchor watch needs no answer. A browser cannot be
 * made to lie about where a request came from, so two headers settle it:
 *
 *   - `Origin`, sent with every cross-origin request that can change anything,
 *     must name this machine (`localhost`, `127.0.0.1` or `[::1]`, any port,
 *     which covers the app's own page and a dev server). `null`, the origin of
 *     a sandboxed frame, does not.
 *   - `Sec-Fetch-Site: cross-site` marks the rest, such as an `<img>` or a
 *     form pointed at the backend, which carry no `Origin`.
 *
 * A request with neither header is not from a browser page at all (the
 * Electron main process, curl on the same machine) and is local as before.
 * A foreign request is not refused here, only no longer waved through: it is
 * treated like one from the network and needs the pairing token.
 */
export declare function isCrossSiteRequest(req: PairingRequest): boolean;
export declare function createLanPairing({ tokenFile }: LanPairingOptions): LanPairing;
