export function isPastDate(isoDate: string): boolean {
  return new Date(`${isoDate}T00:00:00.000Z`).getTime() < Date.now();
}
