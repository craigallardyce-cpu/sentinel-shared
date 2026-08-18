/** Thrown when durable storage was required but OPFS could not be used. */
export class OpfsUnavailableError extends Error {
    constructor(reason) {
        super('OPFS is unavailable, so this database cannot be durable. The OPFS ' +
            'SyncAccessHandle Pool VFS requires a Web Worker — ' +
            'FileSystemFileHandle.createSyncAccessHandle is not exposed on the main ' +
            'thread — so create this adapter inside a worker. Pass ' +
            'allowMemoryFallback: true to accept a non-durable in-memory database. ' +
            'Underlying cause: ' +
            String(reason));
        this.reason = reason;
        this.name = 'OpfsUnavailableError';
    }
}
async function loadSqlite3(options) {
    if (options.sqlite3InitModule)
        return options.sqlite3InitModule();
    const mod = await import('@sqlite.org/sqlite-wasm');
    const init = mod.default ?? mod.sqlite3InitModule;
    return init();
}
export async function createWasmSqliteAdapter(options = {}) {
    const filename = options.filename ?? 'sentinel.db';
    const directory = options.directory ?? '.sentinel-db';
    const sqlite3 = await loadSqlite3(options);
    let db;
    let backend = 'memory';
    let opfsFailure = new Error('installOpfsSAHPoolVfs is not present in this build');
    if (typeof sqlite3.installOpfsSAHPoolVfs === 'function') {
        try {
            const pool = await sqlite3.installOpfsSAHPoolVfs({
                name: directory,
                clearOnInit: options.clearOnInit ?? false,
            });
            db = new pool.OpfsSAHPoolDb(filename);
            backend = 'opfs-sahpool';
        }
        catch (err) {
            // Usually "Missing required OPFS APIs" on the main thread, because
            // createSyncAccessHandle is worker-only. Also possible on an old WebView,
            // in private browsing, or when storage permission is denied.
            opfsFailure = err;
        }
    }
    if (!db) {
        if (!options.allowMemoryFallback)
            throw new OpfsUnavailableError(opfsFailure);
        console.warn('[db-wasm] OPFS unavailable; using a NON-DURABLE in-memory database:', opfsFailure);
        db = new sqlite3.oo1.DB(':memory:', 'c');
    }
    const adapter = {
        get persistent() {
            return backend !== 'memory';
        },
        get backend() {
            return backend;
        },
        async query(sql, params = []) {
            return db.selectObjects(sql, params);
        },
        async get(sql, params = []) {
            return db.selectObject(sql, params);
        },
        async run(sql, params = []) {
            db.exec({ sql, bind: params });
            // last_insert_rowid() is only meaningful after an INSERT; for UPDATE and
            // DELETE it returns whatever the previous insert set, so callers should
            // only read lastID on inserts — same contract as the native adapters.
            const lastID = Number(db.selectValue('select last_insert_rowid()') ?? 0);
            return { lastID, changes: Number(db.changes(false, false) ?? 0) };
        },
        async exec(sql) {
            db.exec(sql);
        },
        async close() {
            db.close();
        },
    };
    return adapter;
}
