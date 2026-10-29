import 'server-only';
import { z } from 'zod';
import { isIsoDate } from '@/domain/dates';

/**
 * What every loader needs when it reads rows from the database. Rows are checked here, at the boundary, so
 * the rest of the app can trust what it gets: a column that is not what the code expects stops the page with a
 * clear message rather than showing a wrong number.
 */

/** A calendar date as the database sends it: 2026-12-20. */
export const isoDay = z.string().refine(isIsoDate, 'expected a calendar date (YYYY-MM-DD)');

/** A moment in time as the database sends it. */
export const timestamp = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'expected a date and time');

/** Stops the page when a read fails. The details are for the server log; the error page tells her to try again. */
export function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`);
}
