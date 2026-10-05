/** 本地日期 YYYY-MM-DD */
export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 解析 YYYY-MM-DD 为本地时间当天 00:00 */
export function parseDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`日期格式应为 YYYY-MM-DD：${s}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function dayRange(dateStr: string): { start: Date; end: Date } {
  const start = parseDate(dateStr);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/** 文件名里可能出现的日期写法 */
export function dateTokens(dateStr: string): string[] {
  const [y, m, d] = dateStr.split("-");
  const mi = String(Number(m));
  const di = String(Number(d));
  return [
    `${y}-${m}-${d}`,
    `${y}.${m}.${d}`,
    `${y}_${m}_${d}`,
    `${y}${m}${d}`,
    `${y}年${mi}月${di}日`,
    `${mi}月${di}日`,
    `${m}-${d}`,
    `${m}.${d}`,
    `${mi}.${di}`,
    `${mi}-${di}`,
  ];
}

/** 文件名是否包含该日期（短格式要求两侧不是数字，避免 10.5 匹配到 110.52） */
export function nameMatchesDate(name: string, dateStr: string): boolean {
  for (const token of dateTokens(dateStr)) {
    let from = 0;
    for (;;) {
      const i = name.indexOf(token, from);
      if (i < 0) break;
      const before = name[i - 1];
      const after = name[i + token.length];
      if (!/\d/.test(before ?? "") && !/\d/.test(after ?? "")) return true;
      from = i + 1;
    }
  }
  return false;
}

export function isSameLocalDay(ts: number, dateStr: string): boolean {
  return formatDate(new Date(ts)) === dateStr;
}

export function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
