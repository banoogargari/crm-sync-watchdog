// Normalize an email so variants of the same address compare equal:
// "  Jane.Doe+sales@Acme.com " -> "jane.doe@acme.com"
export function normalizeEmail(email) {
  if (!email) return '';
  const [local, domain] = email.trim().toLowerCase().split('@');
  if (!domain) return local;
  return `${local.split('+')[0]}@${domain}`;
}

export const emailDomain = (email) => normalizeEmail(email).split('@')[1] ?? '';
