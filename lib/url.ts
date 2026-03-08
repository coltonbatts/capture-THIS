const HTTP_PROTOCOL_PATTERN = /^[a-z][a-z\d+\-.]*:\/\//i;
const DOMAIN_LIKE_PATTERN =
  /^(?:[\da-z-]+\.)+[\da-z-]+(?::\d+)?(?:[/?#].*|$)/i;

export function normalizeUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (HTTP_PROTOCOL_PATTERN.test(trimmed)) {
    return trimmed;
  }

  if (DOMAIN_LIKE_PATTERN.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return trimmed;
}

export function isLikelyUrl(value: string) {
  try {
    const candidate = new URL(normalizeUrl(value));
    return candidate.protocol === "http:" || candidate.protocol === "https:";
  } catch {
    return false;
  }
}

export function extractUrlsFromText(value: string) {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const token of value.split(/\s+/)) {
    const candidate = normalizeUrl(token);

    if (!candidate || !isLikelyUrl(candidate) || seen.has(candidate)) {
      continue;
    }

    seen.add(candidate);
    urls.push(candidate);
  }

  return urls;
}
