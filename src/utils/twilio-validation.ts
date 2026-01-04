/**
 * Twilio Webhook Signature Validation
 *
 * Validates incoming Twilio webhooks using HMAC-SHA1 signatures.
 * https://www.twilio.com/docs/usage/security#validating-requests
 */

import crypto from 'crypto';

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';

/**
 * Validate Twilio webhook signature using HMAC-SHA1
 */
export function validateTwilioSignature(
  signature: string | undefined,
  url: string,
  params: Record<string, string>
): boolean {
  if (!TWILIO_AUTH_TOKEN) {
    console.error('CRITICAL: TWILIO_AUTH_TOKEN not configured - denying request');
    return false;
  }

  if (!signature) {
    console.warn('No X-Twilio-Signature header provided');
    return false;
  }

  // Sort params alphabetically and concatenate
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join('');

  // Build the string to sign: URL + sorted params
  const dataToSign = url + sortedParams;

  // Compute HMAC-SHA1 signature
  const computedSignature = crypto
    .createHmac('sha1', TWILIO_AUTH_TOKEN)
    .update(dataToSign, 'utf-8')
    .digest('base64');

  // Constant-time comparison to prevent timing attacks
  try {
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature, 'base64'),
      Buffer.from(computedSignature, 'base64')
    );

    if (!isValid) {
      console.warn('Twilio signature validation failed');
    }

    return isValid;
  } catch {
    // If buffers have different lengths, timingSafeEqual throws
    console.warn('Twilio signature validation failed - length mismatch');
    return false;
  }
}

/**
 * Extract and validate Twilio request from Fastify request
 *
 * Note: When behind a proxy (like Railway), we need to use the original
 * URL that Twilio sent to, not the internal URL the server sees.
 */
export function validateTwilioRequest(
  headers: Record<string, string | string[] | undefined>,
  url: string,
  body: Record<string, string>
): boolean {
  const signature = Array.isArray(headers['x-twilio-signature'])
    ? headers['x-twilio-signature'][0]
    : headers['x-twilio-signature'];

  // Get the forwarded protocol and host from proxy headers
  const forwardedProto = headers['x-forwarded-proto'] as string | undefined;
  const forwardedHost = headers['x-forwarded-host'] as string | undefined;
  const originalHost = headers['host'] as string | undefined;

  // Build the URL that Twilio actually signed
  // Twilio signs against the public URL, not the internal one
  let validationUrl = url;

  if (forwardedProto || forwardedHost) {
    const proto = forwardedProto || 'https';
    const host = forwardedHost || originalHost;
    // Extract just the path from the full URL
    const urlPath = url.includes('://') ? new URL(url).pathname : url;
    validationUrl = `${proto}://${host}${urlPath}`;
  }

  console.log('[Twilio] Validating signature for URL:', validationUrl);

  return validateTwilioSignature(signature, validationUrl, body);
}
