/**
 * Database adapter contract for the Mariner Sentinel fleet.
 *
 * One async, SQL-shaped interface that the apps' route code calls, with the
 * concrete driver chosen at startup. Extracted from VesselKeeper, which already
 * ran SQLite locally and Postgres against Supabase behind exactly this shape.
 *
 * The interface is deliberately async even where a driver is synchronous
 * (better-sqlite3 is), because the Postgres and any future browser-side driver
 * cannot be. An app moving onto this contract from a synchronous driver has to
 * await at every call site — that cost is real and is why HarborSentinel has
 * not been migrated yet.
 */
export interface RunResult {
    /** Primary key of the inserted row, where the driver reports one. */
    lastID: number;
    /** Rows affected by an INSERT/UPDATE/DELETE. */
    changes: number;
}
export interface DbAdapter {
    /** Execute a SELECT and return all matching rows. */
    query(sql: string, params?: any[]): Promise<any[]>;
    /** Execute an INSERT/UPDATE/DELETE and return lastID + change count. */
    run(sql: string, params?: any[]): Promise<RunResult>;
    /** Execute a SELECT and return the first matching row, or undefined. */
    get(sql: string, params?: any[]): Promise<any>;
    /** Execute raw SQL, e.g. multi-statement DDL. */
    exec(sql: string): Promise<void>;
    /** Close the connection. */
    close(): Promise<void>;
}
export type DatabaseType = 'sqlite' | 'postgres';
/**
 * Chooses the backend from DATABASE_URL.
 *
 * Anything that is not a postgres:// or postgresql:// URI falls back to SQLite.
 * An http(s):// value is almost always someone pasting a Supabase project URL
 * instead of its connection-pooler URI, so that case warns loudly rather than
 * silently running on a local database the user did not intend.
 */
export declare function getDatabaseType(env?: NodeJS.ProcessEnv): DatabaseType;
