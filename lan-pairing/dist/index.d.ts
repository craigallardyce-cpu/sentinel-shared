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
export declare function createLanPairing({ tokenFile }: LanPairingOptions): LanPairing;
