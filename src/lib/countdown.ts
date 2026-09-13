export function countdownValues(target: string, now: number): string[] | null {
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(target)) throw new Error('Countdown requires an explicit timezone offset');
  const end = Date.parse(target);
  if (!Number.isFinite(end) || !Number.isFinite(now)) throw new Error('Invalid countdown date');
  if (now >= end) return null;
  const seconds = Math.ceil((end - now) / 1000);
  return [Math.floor(seconds/86400), Math.floor(seconds%86400/3600), Math.floor(seconds%3600/60), seconds%60].map(n=>String(n).padStart(2,'0'));
}
