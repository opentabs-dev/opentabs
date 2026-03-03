/**
 * Sanitize error messages before returning them to external clients.
 * Strips absolute file paths, URLs, localhost references, and IP addresses
 * to prevent leaking internal system details. Truncates to 500 characters.
 */

const MAX_LENGTH = 500;

const sanitizeErrorMessage = (message: string): string => {
  let sanitized = message
    // Full URLs with protocol — must run before path regexes: the Windows path
    // regex matches "[a-z]:/" which would match the "s:/" in "https://" or the
    // "p:/" in "http://", and the Unix path regex would match the path portion,
    // both leaving a partial URL like "htt[PATH]" instead of "[URL]"
    .replace(/https?:\/\/[^\s,;)}\]]+/gi, '[URL]')
    // Windows absolute paths: C:\path\to\file or C:/path/to/file
    .replace(/[a-z]:[/\\][^\s,;)}\]]+/gi, '[PATH]')
    // Unix absolute paths: /path/to/file — first segment must start with a letter to avoid
    // false positives on numeric segments like "1/2" (fractions/ratios). Requires at least 2
    // segments so single-segment paths like "/api" or "/json" are not stripped (they are more
    // likely URL path fragments than filesystem paths).
    .replace(/\/[a-z][a-z0-9._-]*(?:\/[a-z0-9._-]+)+/gi, '[PATH]')
    // localhost with optional port
    .replace(/localhost(?::\d+)?/gi, '[LOCALHOST]')
    // Bracket-wrapped IPv6 addresses: [::1], [fe80::1], [2001:db8::1], [fe80::1%eth0]
    // Requires at least one colon inside brackets to avoid matching array indices like [0]
    .replace(/\[[0-9a-fA-F]*:[0-9a-fA-F:]*(?:%[^\]]+)?\]/g, '[IP]')
    // Compressed IPv6 addresses (containing ::): ::1, fe80::1, 2001:db8::1, ::ffff:192.168.1.1
    // Must run before IPv4 regex to consume mixed IPv6/IPv4 addresses like ::ffff:192.168.1.1 whole.
    // Structure: zero or more colon-terminated hex groups, an optional final pre-:: hex group (no
    // trailing colon), the :: marker, then the rest of the address.
    .replace(/(?:[0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{0,4}::(?:[0-9a-fA-F:.]+)?/g, '[IP]')
    // IPv4 addresses
    .replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, '[IP]');

  if (sanitized.length > MAX_LENGTH) {
    sanitized = sanitized.slice(0, MAX_LENGTH - 3) + '...';
  }

  return sanitized;
};

export { sanitizeErrorMessage };
