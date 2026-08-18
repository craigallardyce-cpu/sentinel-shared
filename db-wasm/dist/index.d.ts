/**
 * Non-native DbAdapter: SQLite compiled to WebAssembly, persisted through OPFS.
 *
 * This exists because the fleet's native SQLite drivers cannot run under
 * Capacitor, which is why HarborSentinel's Android build currently keeps its
 * anchor sessions and position history in localStorage as JSON strings — a
 * store with a few megabytes of quota holding a table that grows every poll.
 *
 * Two deliberate choices:
 *
 * 1. The OPFS SyncAccessHandle Pool VFS ("opfs-sahpool"), not the plain OPFS
 *    VFS. The plain one needs the page to be cross-origin isolated (COOP/COEP),
 *    which a Capacitor WebView serving from a local origin generally is not.
 *    The pool VFS has no such requirement.
 *
 * 2. Real SQLite over OPFS rather than serialising a whole database in and out
 *    of IndexedDB. The latter is what a sql.js-style driver does, and it would
 *    reproduce the O(total records)-per-write cost that review finding S4 calls
 *    out in OceanSentinel's JSON file. Writes here are incremental.
 *
 * Falls back to an in-memory database when OPFS is unavailable, so callers get
 * a working adapter rather than a crash — but `persistent` reports which they
 * got, because silently losing durability would be worse than failing.
 */
import type { DbAdapter } from '@sentinel/db';
export interface WasmSqliteOptions {
    /** Database filename inside the VFS. */
    filename?: string;
    /** OPFS directory holding the pool's metadata. One VFS per directory. */
    directory?: string;
    /**
     * Wipe storage on init. Only for databases that need not survive a reload —
     * useful in tests.
     */
    clearOnInit?: boolean;
    /**
     * Injected for testing, and so the caller controls how the wasm module is
     * loaded (bundlers differ on how they resolve the .wasm asset).
     */
    sqlite3InitModule?: () => Promise<any>;
    /**
     * Permit falling back to a non-durable in-memory database when OPFS is
     * unavailable. Off by default: silently downgrading a durability layer loses
     * data without anyone noticing, which is worse than refusing to start.
     * Reasonable for tests, or a caller that has its own fallback.
     */
    allowMemoryFallback?: boolean;
}
/** Thrown when durable storage was required but OPFS could not be used. */
export declare class OpfsUnavailableError extends Error {
    readonly reason: unknown;
    constructor(reason: unknown);
}
export interface WasmSqliteAdapter extends DbAdapter {
    /** False when OPFS was unavailable and this fell back to memory. */
    readonly persistent: boolean;
    /** Which VFS backs this database, for diagnostics. */
    readonly backend: 'opfs-sahpool' | 'memory';
}
export declare function createWasmSqliteAdapter(options?: WasmSqliteOptions): Promise<WasmSqliteAdapter>;
