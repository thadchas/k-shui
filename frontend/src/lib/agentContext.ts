/** Freeze the visible relative range when starting an investigation. */
export function investigationWindow(range: string, now = Date.now()) {
  const match = /^(\d+)(m|h|d)$/.exec(range);
  const scale = { m: 60_000, h: 3_600_000, d: 86_400_000 };
  const duration = match ? Number(match[1]) * scale[match[2] as keyof typeof scale] : scale.h;
  return {
    start: new Date(now - duration).toISOString(),
    end: new Date(now).toISOString(),
  };
}
