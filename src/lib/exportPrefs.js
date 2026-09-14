// Export settings live on the user profile, but the PDF/DOCX writers are
// plain functions with no access to it. This is the single adapter between
// the two, so every download path picks up the same saved preference.

export const RESUME_DEFAULTS = { pageSize: 'letter' };

export function exportOptions(profileInfo) {
  return { ...RESUME_DEFAULTS, ...(profileInfo?.resumePreferences || {}) };
}
