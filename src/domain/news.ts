import { describeEvent, isHistoryAction } from './orders/history';

/**
 * What a phone is told after someone of the workspace changed something (decision 0083): who, which job, and what,
 * in the job history's own words. A run of changes to one job is one notification; to several jobs, one that says how
 * many.
 */

export interface NewsLine {
  orderId: string | null;
  action: string;
  details: Record<string, unknown>;
}

export interface NewsMessage {
  title: string;
  body: string;
  /** Where tapping it opens. */
  url: string;
}

export function newsMessage(
  lines: readonly NewsLine[],
  who: string,
  headlineOf: (orderId: string) => string | undefined,
): NewsMessage | null {
  const said = lines.filter((l) => isHistoryAction(l.action));
  if (said.length === 0) return null;
  const jobs = [...new Set(said.map((l) => l.orderId).filter((id): id is string => id !== null))];
  const name = who.trim() || 'Someone';
  const sentence = (l: NewsLine) =>
    describeEvent({ action: l.action as Parameters<typeof describeEvent>[0]['action'], details: l.details });

  if (jobs.length === 1) {
    const [job] = jobs as [string];
    const first = said.find((l) => l.orderId === job)!;
    const more = said.length - 1;
    return {
      title: headlineOf(job) ?? 'A job',
      body: `${name}: ${sentence(first)}${more > 0 ? ` And ${more} more change${more === 1 ? '' : 's'}.` : ''}`,
      url: `/orders/${job}`,
    };
  }
  return {
    title: 'DAGMAWIT',
    body: `${name} changed ${jobs.length || said.length} ${jobs.length === 1 ? 'job' : 'jobs'}.`,
    url: '/orders',
  };
}
