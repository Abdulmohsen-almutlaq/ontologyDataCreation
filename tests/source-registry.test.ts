import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { loadConfig } from '../src/config/Config';
import { ObservationError } from '../src/observation/Observation';
import { parseConnectionUrl, redactUrl, withScheme } from '../src/observation/connection';
import {
  defaultSourceRegistry,
  postgresDriver,
  postgresWireDriver,
} from '../src/observation/SourceRegistry';
import { PostgreSQLObserver } from '../src/observation/PostgreSQLObserver';
import { testEnv } from './helpers';

describe('connection URL handling', () => {
  test('redacts a password without touching anything else', () => {
    assert.equal(
      redactUrl('postgresql://user:hunter2@host:5432/db'),
      'postgresql://user:***@host:5432/db'
    );
  });

  test('a URL with no password redacts to itself', () => {
    assert.equal(redactUrl('postgresql://host:5432/db'), 'postgresql://host:5432/db');
  });

  test('an unparseable string still gets its password blanked', () => {
    assert.equal(
      redactUrl('not a url://user:hunter2@host'),
      'not a url://user:***@host'
    );
  });

  test('parses scheme, host and database', () => {
    const c = parseConnectionUrl('postgresql://user:pw@myhost:5432/mydb');
    assert.equal(c.scheme, 'postgresql');
    assert.equal(c.host, 'myhost:5432');
    assert.equal(c.database, 'mydb');
    assert.ok(!c.redacted.includes('pw'), 'redacted form must not carry the password');
  });

  test('rejects an empty string', () => {
    assert.throws(() => parseConnectionUrl(''), ObservationError);
  });

  test('rejects a string with no scheme', () => {
    assert.throws(() => parseConnectionUrl('just-a-hostname'), /Cannot parse/);
  });

  test('withScheme rewrites only the scheme', () => {
    const rewritten = withScheme('redshift://user:pw@host:5439/dev', 'postgresql');
    assert.equal(rewritten, 'postgresql://user:pw@host:5439/dev');
  });
});

describe('source registry', () => {
  test('resolves every PostgreSQL alias to the verified driver', () => {
    const registry = defaultSourceRegistry();
    for (const scheme of postgresDriver.schemes) {
      assert.equal(registry.get(scheme).name, 'PostgreSQL');
      assert.equal(registry.get(scheme).support, 'verified');
    }
  });

  test('a PostgreSQL-family alias still produces a real PostgreSQLObserver', () => {
    const { observer, driver } = defaultSourceRegistry().createObserver(
      'timescale://user:pw@host:5432/db',
      'public'
    );
    assert.ok(observer instanceof PostgreSQLObserver);
    assert.equal(driver.name, 'PostgreSQL');
  });

  test('a wire-compatible alias connects but carries a note', () => {
    const registry = defaultSourceRegistry();
    for (const scheme of postgresWireDriver.schemes) {
      const driver = registry.get(scheme);
      assert.equal(driver.support, 'wire-compatible');
      assert.ok(driver.note && driver.note.length > 0);
    }
    const { observer } = registry.createObserver(
      'redshift://user:pw@cluster:5439/dev',
      'public'
    );
    assert.ok(observer instanceof PostgreSQLObserver);
  });

  test('an unimplemented scheme is recognised, not silently rejected', () => {
    const registry = defaultSourceRegistry();
    assert.equal(registry.get('snowflake').support, 'unimplemented');
    assert.throws(
      () => registry.createObserver('snowflake://user:pw@account/db', 'public'),
      /No observer is implemented for Snowflake.*snowflake-sdk/s
    );
  });

  test('an unknown scheme names the connectable ones', () => {
    assert.throws(
      () => defaultSourceRegistry().get('ftp'),
      /No driver is registered for "ftp:\/\/".*postgres/s
    );
  });

  test('usableSchemes excludes unimplemented drivers', () => {
    const usable = defaultSourceRegistry().usableSchemes();
    assert.ok(usable.includes('postgresql'));
    assert.ok(!usable.includes('snowflake'));
  });

  test('list includes every registered scheme, including unimplemented ones', () => {
    const rows = defaultSourceRegistry().list();
    assert.ok(rows.some((r) => r.scheme === 'snowflake' && r.driver.support === 'unimplemented'));
    assert.ok(rows.some((r) => r.scheme === 'postgresql' && r.driver.support === 'verified'));
  });
});

describe('DATABASE_URL structural validation', () => {
  test('a malformed DATABASE_URL fails at config load, before any driver is touched', () => {
    assert.throws(
      () =>
        loadConfig(
          testEnv('stop-early', { SOURCE_KIND: 'postgres', DATABASE_URL: 'not-a-url' })
        ),
      /Cannot parse connection URL/
    );
  });

  test('a well-formed URL for an unresolved scheme still passes config validation', () => {
    // Config.ts only checks URL syntax; resolving the scheme to a driver is
    // sourceFromConfig's job, deliberately, so Config.ts never imports `pg`.
    const config = loadConfig(
      testEnv('stop-early', {
        SOURCE_KIND: 'postgres',
        DATABASE_URL: 'snowflake://user:pw@account/db',
      })
    );
    assert.equal(config.source.databaseUrl, 'snowflake://user:pw@account/db');
  });
});
