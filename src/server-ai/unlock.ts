export function constantTimeTextEqual(candidate: unknown, expected: string | undefined): boolean {
  if (typeof candidate !== "string" || !expected) return false;

  const length = Math.max(candidate.length, expected.length);
  let difference = candidate.length ^ expected.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (candidate.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }

  return difference === 0;
}

export function isValidUnlockCode(candidate: unknown): boolean {
  return constantTimeTextEqual(candidate, process.env["UNLOCK_CODE"]);
}