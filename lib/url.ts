export function isLikelyUrl(value: string) {
  try {
    const candidate = new URL(value);
    return candidate.protocol === "http:" || candidate.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeUrl(value: string) {
  return value.trim();
}
