export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

export function isValidEmail(email?: unknown): boolean {
  if (typeof email !== 'string') return false;
  return EMAIL_REGEX.test(email.trim());
}

export function cleanMobile(mobile?: unknown): string {
  if (typeof mobile !== 'string' && typeof mobile !== 'number') return '';
  return String(mobile).replace(/\D/g, '');
}

export function isValidMobile(mobile?: unknown): boolean {
  const digits = cleanMobile(mobile);
  return INDIAN_MOBILE_REGEX.test(digits);
}

/**
 * Digits of an Indian mobile with a leading +91 / 91 / 0 dropped ("+91 98765 43210" → "9876543210").
 * Anything that is not such a number comes back as plain digits, exactly like cleanMobile.
 */
export function normalizeIndianMobile(mobile?: unknown): string {
  const digits = cleanMobile(mobile);
  if (digits.length === 12 && digits.startsWith('91') && INDIAN_MOBILE_REGEX.test(digits.slice(2))) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0') && INDIAN_MOBILE_REGEX.test(digits.slice(1))) return digits.slice(1);
  return digits;
}

export function normalizeEmail(email?: unknown): string {
  return String(email || '').trim().toLowerCase();
}
