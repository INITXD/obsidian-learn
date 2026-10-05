import { requestUrl } from "obsidian";
import { matchCourse, parseAliases } from "./core/aliases.ts";
import { dayRange } from "./core/dates.ts";
import { eventsInRange, normalizeIcsUrl, type CalendarEvent } from "./core/ics.ts";
import type CourseTutorPlugin from "./main.ts";

export interface CourseEvent extends CalendarEvent {
  /** 匹配到的课程文件夹；null 表示课表里的其他事件 */
  course: string | null;
}

export interface DayEvents {
  events: CourseEvent[];
  error?: string;
  /** 网络失败时使用了上次缓存 */
  stale?: boolean;
}

const TTL_MS = 6 * 3600 * 1000;

export class CalendarService {
  private memory: { url: string; text: string; fetchedAt: number } | null = null;

  constructor(private plugin: CourseTutorPlugin) {}

  invalidate(): void {
    this.memory = null;
  }

  private async getIcs(force: boolean): Promise<{ text: string; stale: boolean }> {
    const url = normalizeIcsUrl(this.plugin.settings.icsUrl);
    if (!force && this.memory?.url === url && Date.now() - this.memory.fetchedAt < TTL_MS) {
      return { text: this.memory.text, stale: false };
    }
    try {
      const res = await requestUrl({ url, method: "GET" });
      this.memory = { url, text: res.text, fetchedAt: Date.now() };
      await this.plugin.saveIcsCache(this.memory);
      return { text: res.text, stale: false };
    } catch (e) {
      const cached = this.plugin.icsCache;
      if (cached?.url === url) return { text: cached.text, stale: true };
      throw e;
    }
  }

  async eventsOn(date: string, force = false): Promise<DayEvents> {
    if (!this.plugin.settings.icsUrl) return { events: [] };
    try {
      const { text, stale } = await this.getIcs(force);
      const { start, end } = dayRange(date);
      const courses = this.plugin.repo.listCourses();
      const aliases = parseAliases(this.plugin.settings.courseAliases);
      const events = eventsInRange(text, start, end).map((e) => ({
        ...e,
        course: matchCourse(e.summary, courses, aliases),
      }));
      return { events, stale };
    } catch (e) {
      return { events: [], error: e instanceof Error ? e.message : String(e) };
    }
  }
}
