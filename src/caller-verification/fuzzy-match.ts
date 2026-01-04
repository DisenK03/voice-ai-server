/**
 * Fuzzy Matching Utilities
 *
 * Functions for fuzzy name matching and string manipulation.
 */

import { ClaimedIdentity } from './types.js';

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Fuzzy match names - handles first name only, slight misspellings
 */
export function fuzzyNameMatch(storedName: string, claimedName: string): boolean {
  const stored = storedName.toLowerCase().trim();
  const claimed = claimedName.toLowerCase().trim();

  // Exact match
  if (stored === claimed) return true;

  // First name match
  const storedFirst = stored.split(' ')[0];
  const claimedFirst = claimed.split(' ')[0];
  if (storedFirst === claimedFirst) return true;

  // Levenshtein distance for slight misspellings (max 2 edits)
  if (levenshteinDistance(storedFirst, claimedFirst) <= 2) return true;

  // Last name match
  const storedParts = stored.split(' ');
  const claimedParts = claimed.split(' ');
  if (storedParts.length > 1 && claimedParts.length > 1) {
    const storedLast = storedParts[storedParts.length - 1];
    const claimedLast = claimedParts[claimedParts.length - 1];
    if (storedLast === claimedLast) return true;
  }

  return false;
}

/**
 * Normalize unit number for comparison
 */
export function normalizeUnit(unit: string): string {
  return unit.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Capitalize a name properly
 */
export function capitalizeName(name: string): string {
  return name
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Normalize phone number to E.164 format
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return '+1' + digits;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return '+' + digits;
  }
  return phone.startsWith('+') ? phone : '+' + digits;
}

/**
 * Parse claimed identity from conversation transcript
 * Looks for patterns like "John Smith", "Unit 4B", etc.
 */
export function parseClaimedIdentity(transcript: string): ClaimedIdentity {
  let name: string | null = null;
  let unit: string | null = null;

  // Look for name patterns
  // "I'm John Smith", "My name is John", "This is John Smith"
  const namePatterns = [
    /(?:i'm|i am|my name is|this is|it's|its)\s+([a-z]+(?:\s+[a-z]+)?)/i,
    /name\s+(?:is\s+)?([a-z]+(?:\s+[a-z]+)?)/i,
  ];

  for (const pattern of namePatterns) {
    const match = transcript.match(pattern);
    if (match) {
      name = capitalizeName(match[1].trim());
      break;
    }
  }

  // Look for unit patterns
  // "Unit 4B", "apartment 12", "4B", "#5"
  const unitPatterns = [
    /(?:unit|apartment|apt|#)\s*([a-z0-9]+)/i,
    /(?:in|from)\s+(?:unit\s+)?([0-9]+[a-z]?)/i,
    /(?:live in|staying at)\s+([0-9]+[a-z]?)/i,
  ];

  for (const pattern of unitPatterns) {
    const match = transcript.match(pattern);
    if (match) {
      unit = match[1].toUpperCase();
      break;
    }
  }

  return { name, unit };
}
