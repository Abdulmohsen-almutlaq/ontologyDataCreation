import { ObservationError } from './Observation';

/**
 * Connection-string handling, kept apart from any driver.
 *
 * A connection URL is the one place in this system where a secret travels
 * inside something people paste, log and screenshot. Everything here exists so
 * that the password is separated from the parts that are safe to show.
 */

export interface ParsedConnection {
  /** lower-cased scheme with no trailing colon, e.g. "postgresql" */
  scheme: string;
  /** the URL as given, unchanged */
  raw: string;
  /** password replaced, safe to print, log and put in an error */
  redacted: string;
  host: string;
  /** leading slash stripped; empty when the URL carries no path */
  database: string;
}

/**
 * Replaces the password and nothing else.
 *
 * Falls back to a blunt regex when the string does not parse: a malformed URL
 * is exactly the case where the message wants to be printed, so "unparseable"
 * must not become "printed in full".
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return url.replace(/\/\/([^:/@]+):[^@]*@/, '//$1:***@');
  }
}

export function parseConnectionUrl(url: string): ParsedConnection {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new ObservationError('Connection URL is empty', 'BAD_CONNECTION_URL');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ObservationError(
      `Cannot parse connection URL "${redactUrl(trimmed)}". ` +
        'Expected scheme://user:password@host:port/database',
      'BAD_CONNECTION_URL'
    );
  }

  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  if (!scheme) {
    throw new ObservationError(
      `Connection URL "${redactUrl(trimmed)}" has no scheme`,
      'BAD_CONNECTION_URL'
    );
  }

  return {
    scheme,
    raw: trimmed,
    redacted: redactUrl(trimmed),
    host: parsed.host,
    database: parsed.pathname.replace(/^\//, ''),
  };
}

/**
 * Rewrites the scheme, leaving every other component byte-identical.
 *
 * A Redshift or CockroachDB URL is a PostgreSQL URL wearing a different label,
 * and `pg` rejects labels it does not recognise. Rewriting the scheme is what
 * lets one driver serve a family without the caller having to lie about which
 * system they are pointing at.
 */
export function withScheme(url: string, scheme: string): string {
  const parsed = new URL(url.trim());
  parsed.protocol = `${scheme}:`;
  return parsed.toString();
}
