import { describe, it, expect, vi, afterEach } from 'vitest';
import { getDatabaseType } from '../src/index';

afterEach(() => vi.restoreAllMocks());

describe('getDatabaseType', () => {
  it('selects postgres for both postgres:// and postgresql:// URIs', () => {
    expect(getDatabaseType({ DATABASE_URL: 'postgresql://user:pw@host:5432/db' })).toBe('postgres');
    expect(getDatabaseType({ DATABASE_URL: 'postgres://user:pw@host:5432/db' })).toBe('postgres');
  });

  it('falls back to sqlite when DATABASE_URL is absent or empty', () => {
    expect(getDatabaseType({})).toBe('sqlite');
    expect(getDatabaseType({ DATABASE_URL: '' })).toBe('sqlite');
  });

  it('treats a plain file path as sqlite', () => {
    expect(getDatabaseType({ DATABASE_URL: '/var/data/vessel.db' })).toBe('sqlite');
  });

  it('warns and falls back to sqlite for an http(s) URL — the pasted-project-URL mistake', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getDatabaseType({ DATABASE_URL: 'https://abc.supabase.co' })).toBe('sqlite');
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/connection pooler/i);
  });

  it('does not warn for an ordinary sqlite fallback', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getDatabaseType({ DATABASE_URL: './local.db' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads process.env by default', () => {
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://host/db';
    try {
      expect(getDatabaseType()).toBe('postgres');
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });
});
