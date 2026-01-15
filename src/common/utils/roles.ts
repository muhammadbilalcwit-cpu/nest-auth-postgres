export function normalizeRoleSlug(slug?: string) {
  if (!slug) return '';
  try {
    return String(slug).toLowerCase().trim();
  } catch (e) {
    return '';
  }
}
