export function wordBulletMarker(levelText: string): string {
  return (
    {
      "\uf0a7": "▪",
      "\uf0b7": "•",
      "\uf0d8": "➢",
      "\uf0fc": "✓",
    } satisfies Record<string, string>
  )[levelText] ?? (levelText || "•");
}
