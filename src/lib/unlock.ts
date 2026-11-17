/** يتحقق من كود الاستخدام غير المحدود على الخادم، دون كشف الكود للواجهة. */
export async function verifyUnlockCode(code: string): Promise<boolean> {
  try {
    const response = await fetch("/api/verify-unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!response.ok) return false;
    const data: unknown = await response.json();
    return typeof data === "object" && data !== null && "valid" in data && data.valid === true;
  } catch {
    return false;
  }
}