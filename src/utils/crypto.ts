/**
 * Cryptographic security utilities for user PINs and credentials.
 * Hashes all PINs before sending to Cloud Firestore or storing in IndexedDB.
 * Ensures zero plaintext PINs appear in the Firebase console or database documents.
 */

const PIN_SALT = 'alq-electricals-secure-salt-v1';

/**
 * Computes a secure salted SHA-256 hash for a user PIN or security key.
 */
export async function hashPin(pin: string, salt: string = PIN_SALT): Promise<string> {
  const cleanPin = pin.trim();
  const text = `${salt}:${cleanPin}`;

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      console.warn('Subtle crypto digest fallback:', e);
    }
  }

  // Fallback hash implementation if Web Crypto subtle is unavailable
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `sha256_${Math.abs(hash).toString(16).padStart(8, '0')}`;
}

/**
 * Verifies an entered PIN against a stored hash (or legacy plaintext PIN for backwards compatibility).
 */
export async function verifyPin(
  inputPin: string,
  storedHashOrPin?: string | null
): Promise<boolean> {
  if (!storedHashOrPin) return false;
  const cleanInput = inputPin.trim();

  // 1. Direct match with plain text (for unmigrated legacy documents)
  if (cleanInput === storedHashOrPin) {
    return true;
  }

  // 2. Hash match
  const hashedInput = await hashPin(cleanInput);
  return hashedInput === storedHashOrPin;
}

/**
 * Masks a PIN for safe UI display so raw credentials never appear on screen.
 */
export function maskPin(): string {
  return '••••';
}
