/**
 * Prompt Sanitizer
 *
 * Sanitizes user data before including in LLM prompts to prevent
 * prompt injection attacks.
 */

/**
 * Sanitize user-provided data for safe inclusion in LLM prompts.
 * Removes potential prompt injection patterns.
 */
export function sanitizeForPrompt(text: string | null | undefined, maxLength = 100): string {
  if (!text) return '';

  return (
    text
      // Remove any bracketed instructions that could override system prompt
      .replace(/\[.*?\]/g, '')
      // Remove common prompt injection keywords (case insensitive)
      .replace(/ignore\s*(all)?\s*(previous|above|prior)?\s*instructions?/gi, '')
      .replace(/disregard\s*(all)?\s*(previous|above|prior)?\s*instructions?/gi, '')
      .replace(/forget\s*(all)?\s*(previous|above|prior)?\s*instructions?/gi, '')
      .replace(/system\s*prompt/gi, '')
      .replace(/you\s*are\s*now/gi, '')
      .replace(/new\s*instructions?/gi, '')
      .replace(/override/gi, '')
      .replace(/jailbreak/gi, '')
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]*`/g, '')
      // Remove excessive whitespace and newlines
      .replace(/\n{2,}/g, ' ')
      .replace(/\s{2,}/g, ' ')
      // Trim and limit length
      .trim()
      .slice(0, maxLength)
  );
}

/**
 * Sanitize a name specifically - more restrictive
 */
export function sanitizeName(name: string | null | undefined): string {
  if (!name) return '';

  return (
    name
      // Only allow letters, spaces, hyphens, apostrophes
      .replace(/[^a-zA-Z\s\-']/g, '')
      // Remove common injection patterns
      .replace(/\[.*?\]/g, '')
      .replace(/ignore|system|prompt|override|instructions?/gi, '')
      // Collapse whitespace
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 50)
  );
}

/**
 * Sanitize a unit number - very restrictive
 */
export function sanitizeUnit(unit: string | null | undefined): string {
  if (!unit) return '';

  return (
    unit
      // Only allow alphanumeric, spaces, hyphens
      .replace(/[^a-zA-Z0-9\s\-#]/g, '')
      .trim()
      .slice(0, 20)
  );
}
