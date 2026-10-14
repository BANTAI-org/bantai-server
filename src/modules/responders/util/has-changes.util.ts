export function hasChanges(patch: object): boolean {
  return Object.values(patch).some((value) => value !== undefined);
}
