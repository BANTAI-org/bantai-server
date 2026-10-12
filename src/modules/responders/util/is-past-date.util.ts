export function isPastDate(date: Date | string): boolean {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d && d instanceof Date && !isNaN(d.getTime()) && d < new Date();
}