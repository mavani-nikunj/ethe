/** Canonical codes used on blueprint stages: ACE, AO, ASSOC_DEAN. */
export function normalizeAuthoritySlot(slot?: string | null): string {
  if (!slot) return '';
  const raw = String(slot).trim().toUpperCase().replace(/[\s-]+/g, '_');
  const aliases: Record<string, string> = {
    ASSOCIATE_DEAN: 'ASSOC_DEAN',
    ASSOCDEAN: 'ASSOC_DEAN',
    AD: 'ASSOC_DEAN',
    ACADEMIC: 'ACE',
    ACADEMIC_SECTION: 'ACE',
    ACCOUNTS: 'AO',
    ACCOUNTS_OFFICER: 'AO',
  };
  return aliases[raw] || raw;
}

/** Empty user slot stays allowed (same as before). Mismatched spellings are treated as equal. */
export function authoritySlotsMatch(stageSlot?: string | null, userSlot?: string | null): boolean {
  if (!stageSlot) return true;
  if (!userSlot) return true;
  return normalizeAuthoritySlot(stageSlot) === normalizeAuthoritySlot(userSlot);
}
