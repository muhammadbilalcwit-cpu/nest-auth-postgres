export function normalizeRoleSlug(slug?: string): string {
  if (!slug) return '';
  try {
    return String(slug).toLowerCase().trim();
  } catch {
    return '';
  }
}
