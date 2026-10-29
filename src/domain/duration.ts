/** How lengths of time are written everywhere in the app: "5h 15m", "3h 00m", "45 min". */
export function formatMinutes(total: number): string {
  if (!Number.isInteger(total) || total < 0) throw new RangeError(`Not a whole number of minutes: ${total}`);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}
