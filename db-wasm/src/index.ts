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
import type { DbAdapter, RunResult } from '@sentinel/db';

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
export class OpfsUnavailableError extends Error {
  constructor(public readonly reason: unknown) {
    super(
      'OPFS is unavailable, so this database cannot be durable. The OPFS ' +
        'SyncAccessHandle Pool VFS requires a Web Worker — ' +
        'FileSystemFileHandle.createSyncAccessHandle is not exposed on the main ' +
        'thread — so create this adapter inside a worker. Pass ' +
        'allowMemoryFallback: true to accept a non-durable in-memory database. ' +
        'Underlying cause: ' +
        String(reason)
    );
    this.name = 'OpfsUnavailableError';
  }
}

export interface WasmSqliteAdapter extends DbAdapter {
  /** False when OPFS was unavailable and this fell back to memory. */
  readonly persistent: boolean;
  /** Which VFS backs this database, for diagnostics. */
  readonly backend: 'opfs-sahpool' | 'memory';
}

async function loadSqlite3(options: WasmSqliteOptions): Promise<any> {
  if (options.sqlite3InitModule) return options.sqlite3InitModule();
  const mod: any = await import('@sqlite.org/sqlite-wasm');
  const init = mod.default ?? mod.sqlite3InitModule;
  return init();
}

export async function createWasmSqliteAdapter(
  options: WasmSqliteOptions = {}
): Promise<WasmSqliteAdapter> {
  const filename = options.filename ?? 'sentinel.db';
  const directory = options.directory ?? '.sentinel-db';

  const sqlite3 = await loadSqlite3(options);

  let db: any;
  let backend: 'opfs-sahpool' | 'memory' = 'memory';
  let opfsFailure: unknown = new Error('installOpfsSAHPoolVfs is not present in this build');

  if (typeof sqlite3.installOpfsSAHPoolVfs === 'function') {
    try {
      const pool = await sqlite3.installOpfsSAHPoolVfs({
        name: directory,
        clearOnInit: options.clearOnInit ?? false,
      });
      db = new pool.OpfsSAHPoolDb(filename);
      backend = 'opfs-sahpool';
    } catch (err) {
      // Usually "Missing required OPFS APIs" on the main thread, because
      // createSyncAccessHandle is worker-only. Also possible on an old WebView,
      // in private browsing, or when storage permission is denied.
      opfsFailure = err;
    }
  }

  if (!db) {
    if (!options.allowMemoryFallback) throw new OpfsUnavailableError(opfsFailure);
    console.warn('[db-wasm] OPFS unavailable; using a NON-DURABLE in-memory database:', opfsFailure);
    db = new sqlite3.oo1.DB(':memory:', 'c');
  }

  const adapter: WasmSqliteAdapter = {
    get persistent() {
      return backend !== 'memory';
    },
    get backend() {
      return backend;
    },

    async query(sql: string, params: any[] = []): Promise<any[]> {
      return db.selectObjects(sql, params);
    },

    async get(sql: string, params: any[] = []): Promise<any> {
      return db.selectObject(sql, params);
    },

    async run(sql: string, params: any[] = []): Promise<RunResult> {
      db.exec({ sql, bind: params });
      // last_insert_rowid() is only meaningful after an INSERT; for UPDATE and
      // DELETE it returns whatever the previous insert set, so callers should
      // only read lastID on inserts — same contract as the native adapters.
      const lastID = Number(db.selectValue('select last_insert_rowid()') ?? 0);
      return { lastID, changes: Number(db.changes(false, false) ?? 0) };
    },

    async exec(sql: string): Promise<void> {
      db.exec(sql);
    },

    async close(): Promise<void> {
      db.close();
    },
  };

  return adapter;
}
