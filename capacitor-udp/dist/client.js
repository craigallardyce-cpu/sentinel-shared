import { SentinelUdp } from './plugin.js';
/*
  A phone's own UDP listener for an NMEA gateway, in the shape of the apps' TCP
  clients (HarborSentinel `utils/capacitorTcp.ts`, OceanSentinel
  `utils/capacitorTcp.js`), so each call site picks a client by protocol and
  changes nothing else.

  It behaves as the desktop's UDP input does (`@sentinel/marine` nmeaPool), so a
  gateway reads the same on a phone as through the boat PC:

  - Each datagram is split into lines on its own. UDP has no continuity between
    datagrams, so a partial line is dropped rather than joined to the next one.
  - Only lines starting `$` or `!` (NMEA 0183 and AIS) are passed on.
  - The address, when one was given, filters on the sender; empty listens to
    anyone on the port. Compared as written, as the desktop does.
  - Silence for `UDP_DATA_TIMEOUT_MS` ends the listener through `onError`, so
    the caller's reconnect rebinds it, as the desktop rebinds on silence. That is
    also how the feed comes to read as lost when the gateway goes quiet.

  The contract the callers already rely on:

  - `connect()` closes this client's previous listener first.
  - It resolves once the port is bound and rejects when it cannot be bound;
    `onError` is not also called for that, so one failure schedules one
    reconnect.
  - After the bind, the end is `onError`, once. `onClose` is never called: a
    UDP listener has no other side to close it. It is accepted so the call
    sites keep one shape.
  - Nothing arrives after `disconnect()` or a later `connect()`.
*/
export const UDP_DATA_TIMEOUT_MS = 15000;
const stripBrackets = (value) => value.trim().replace(/^\[(.*)\]$/, '$1').toLowerCase();
/** Whether a datagram from `address` passes the gateway address filter. */
export function sourceMatches(filterHost, address) {
    const wanted = filterHost ? stripBrackets(filterHost) : '';
    if (!wanted)
        return true;
    // An event with no sender cannot be checked, and is trusted rather than
    // silenced, as the desktop does.
    if (!address)
        return true;
    return stripBrackets(address) === wanted;
}
/** The NMEA lines in one datagram. */
export function splitDatagram(text) {
    const lines = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (line.startsWith('$') || line.startsWith('!'))
            lines.push(line);
    }
    return lines;
}
function parsePort(port) {
    const value = typeof port === 'number' ? port : parseInt(String(port), 10);
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
        throw new Error(`Not a UDP port: ${port}`);
    }
    return value;
}
export class CapacitorUdpClient {
    constructor({ plugin = SentinelUdp, dataTimeoutMs = UDP_DATA_TIMEOUT_MS } = {}) {
        this.session = null;
        this.plugin = plugin;
        this.dataTimeoutMs = dataTimeoutMs;
    }
    /** Whether a listener is open, or being opened. */
    get isActive() {
        return this.session !== null;
    }
    async connect(host, port, onData, onError, _onClose) {
        await this.disconnect();
        const portNumber = parsePort(port);
        const session = { id: null, ended: false, handles: [], timer: null };
        this.session = session;
        const current = () => this.session === session && !session.ended;
        const fail = (err) => {
            if (!current())
                return;
            this.retire(session);
            onError?.(err);
        };
        const arm = () => {
            if (session.timer)
                clearTimeout(session.timer);
            session.timer = setTimeout(() => {
                fail(new Error(`Nothing heard on UDP port ${portNumber} for ${Math.round(this.dataTimeoutMs / 1000)} s`));
            }, this.dataTimeoutMs);
        };
        try {
            // Listeners before the bind, so the first datagram has somewhere to go.
            session.handles.push(await this.plugin.addListener('datagram', (event) => {
                if (!current() || event.id !== session.id)
                    return;
                if (!sourceMatches(host, event.address))
                    return;
                const lines = splitDatagram(event.data ?? '');
                if (lines.length === 0)
                    return;
                arm();
                for (const line of lines) {
                    if (!current())
                        return;
                    onData(line);
                }
            }));
            session.handles.push(await this.plugin.addListener('error', (event) => {
                if (!current() || event.id !== session.id)
                    return;
                fail(new Error(event.message || 'UDP listener failed'));
            }));
            if (!current()) {
                await this.release(session);
                return;
            }
            const { id } = await this.plugin.listen({ port: portNumber });
            session.id = id;
        }
        catch (err) {
            const mine = this.session === session;
            if (mine)
                this.session = null;
            session.ended = true;
            await this.release(session);
            // Abandoned attempts resolve quietly; a real failure is the rejection.
            if (mine)
                throw err;
            return;
        }
        if (!current()) {
            // disconnect() or another connect() arrived while the port was binding.
            await this.release(session);
            return;
        }
        console.log(`[CapacitorUDP] Listening on UDP port ${portNumber}${host ? ` for ${host}` : ''}`);
        arm();
    }
    async disconnect() {
        const session = this.session;
        if (!session)
            return;
        this.session = null;
        session.ended = true;
        await this.release(session);
    }
    /** UDP input is receive-only here, as it is on the desktop. */
    async send(_data) {
        console.warn('[CapacitorUDP] Not sending: UDP input is receive-only');
    }
    /** End a session that stopped by itself, without waiting on the native close. */
    retire(session) {
        if (this.session === session)
            this.session = null;
        session.ended = true;
        void this.release(session);
    }
    async release(session) {
        if (session.timer)
            clearTimeout(session.timer);
        session.timer = null;
        const handles = session.handles.splice(0);
        await Promise.all(handles.map((h) => h.remove().catch(() => { })));
        if (session.id !== null) {
            const id = session.id;
            session.id = null;
            await this.plugin.close({ id }).catch(() => { });
        }
    }
}
/**
 * Listen for a while and count the NMEA sentences heard: the Settings dialogs'
 * "Test" under UDP, which has nothing to connect to and so can only report what
 * arrived. Rejects when the port cannot be bound.
 */
export async function listenForSentences({ host, port, durationMs = 5000, plugin }) {
    const client = new CapacitorUdpClient({ plugin, dataTimeoutMs: durationMs + 60000 });
    let heard = 0;
    await client.connect(host, port, () => {
        heard += 1;
    });
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    await client.disconnect();
    return heard;
}
