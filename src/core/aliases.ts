/**
 * 课程别名配置，每行一条：
 *   课程文件夹名 = 关键词1, 关键词2
 * 课表事件标题包含任一关键词（或课程文件夹名本身）即视为该课程。
 */
export function parseAliases(text: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const course = line.slice(0, eq).trim();
    const keywords = line
      .slice(eq + 1)
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!course) continue;
    map.set(course, [...(map.get(course) ?? []), ...keywords]);
  }
  return map;
}

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

/** 返回与事件标题最匹配的课程（关键词最长者优先），没有匹配返回 null */
export function matchCourse(
  summary: string,
  courses: string[],
  aliases: Map<string, string[]>,
): string | null {
  const s = normalize(summary);
  if (!s) return null;
  let best: { course: string; len: number } | null = null;
  for (const course of courses) {
    for (const kw of [course, ...(aliases.get(course) ?? [])]) {
      const k = normalize(kw);
      if (k && s.includes(k) && (!best || k.length > best.len)) {
        best = { course, len: k.length };
      }
    }
  }
  return best?.course ?? null;
}
