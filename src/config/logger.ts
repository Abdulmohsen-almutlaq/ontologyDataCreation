import pino from 'pino';

export type Logger = pino.Logger;

export function createLogger(level: string): Logger {
  return pino(
    {
      level: level === 'silent' ? 'silent' : level,
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    // Logs on stderr, the human-readable report on stdout: piping one does not
    // corrupt the other.
    pino.destination(2)
  );
}
