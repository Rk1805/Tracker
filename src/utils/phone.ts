export function normalizeIndianPhoneNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('91') && digits.length === 12) return `+${digits}`;

  const nationalNumber = digits.replace(/^0+/, '');
  return nationalNumber.length === 10 ? `+91${nationalNumber}` : `+${nationalNumber}`;
}

export function isValidIndianPhoneNumber(value: string): boolean {
  return /^\+91[6-9]\d{9}$/.test(normalizeIndianPhoneNumber(value));
}
