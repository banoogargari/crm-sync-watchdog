// Dates are plain 'YYYY-MM-DD' strings; all math is done in UTC.
const DAY = 86_400_000;
const toMs = (d) => Date.parse(`${d}T00:00:00Z`);
export const addDays = (d, n) => new Date(toMs(d) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((toMs(b) - toMs(a)) / DAY);
export const inPeriod = (d, period) => !!d && d >= period.start && d <= period.end;
