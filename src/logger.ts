/**
 * logger.ts — Configurable logger for the Weave pipeline
 *
 * Usage in pipeline modules:
 *   import { logger } from '../logger.js';
 *   logger.info('netlist-parser: skipping subckt body line');
 *   logger.warn('asc2net: SpiceOrder contains non-numeric tokens');
 *
 * Usage in app.ts (set the sink before any pipeline call):
 *   import { logger } from './logger.js';
 *   logger.onEmit = (level, msg) => clog(msg, level === 'warn' ? 'warn' : undefined);
 *   logger.level = 'debug'; // or 'info' | 'warn' | 'error'
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[logger.level];
}

function emit(level: LogLevel, msg: string): void {
  if (logger.onEmit) {
    logger.onEmit(level, msg);
  } else {
    // Fallback: write to browser console when no sink is registered
    (console as Record<string, (...a: unknown[]) => void>)[level]?.(msg) ?? console.log(msg);
  }
}

export const logger = {
  /** Minimum level to emit. Messages below this level are silently dropped. */
  level: 'info' as LogLevel,

  /**
   * Optional sink registered by the UI layer. When set, all log messages at
   * or above `level` are passed here instead of going to the browser console.
   * Set to null to restore console fallback.
   */
  onEmit: null as ((level: LogLevel, msg: string) => void) | null,

  debug: (msg: string): void => { if (shouldLog('debug')) emit('debug', msg); },
  info:  (msg: string): void => { if (shouldLog('info'))  emit('info',  msg); },
  warn:  (msg: string): void => { if (shouldLog('warn'))  emit('warn',  msg); },
  error: (msg: string): void => { if (shouldLog('error')) emit('error', msg); },
};
