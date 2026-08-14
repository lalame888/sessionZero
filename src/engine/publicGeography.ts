/** 公開舞台：只留地名，去掉括號／「含…」場景清單（避免開場洩漏地圖）。 */
export function sanitizePublicGeography(
  raw?: string | null,
): string | undefined {
  const t = (raw ?? "").trim();
  if (!t) return undefined;
  const noParen = t
    .replace(/[（(][^）)]*[）)]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cut = noParen.split(/含|包括|：|:/)[0]?.trim() ?? noParen;
  const first = cut.split(/[，,、；;]/)[0]?.trim() ?? cut;
  const label = first.replace(/[。.\s]+$/g, "").trim();
  return label || undefined;
}

export function publicGeographyLabel(raw?: string | null): string {
  return sanitizePublicGeography(raw) ?? "";
}
