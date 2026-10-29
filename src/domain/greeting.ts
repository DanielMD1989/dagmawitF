/** The greeting for an hour of her local day (0 to 23). */
export function greetingFor(hour: number): 'Good morning' | 'Good afternoon' | 'Good evening' {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23)
    throw new RangeError(`Not an hour of the day: ${hour}`);
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
