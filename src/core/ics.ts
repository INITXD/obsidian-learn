import ICAL from "ical.js";

export interface CalendarEvent {
  summary: string;
  location: string;
  start: Date;
  end: Date;
}

const MAX_ITERATIONS = 5000;

/** 展开 ICS（含 RRULE/EXDATE/RECURRENCE-ID），返回与 [rangeStart, rangeEnd) 有交集的事件 */
export function eventsInRange(icsText: string, rangeStart: Date, rangeEnd: Date): CalendarEvent[] {
  const root = new ICAL.Component(ICAL.parse(icsText));
  for (const tz of root.getAllSubcomponents("vtimezone")) {
    ICAL.TimezoneService.register(tz);
  }
  const startMs = rangeStart.getTime();
  const endMs = rangeEnd.getTime();
  const out: CalendarEvent[] = [];
  const push = (summary: string, location: string, s: Date, e: Date) => {
    if (s.getTime() < endMs && e.getTime() > startMs) out.push({ summary, location, start: s, end: e });
  };

  // 按 UID 分组：主事件 + RECURRENCE-ID 例外（调课、改地点等）
  const groups = new Map<string, { master?: ICAL.Component; exceptions: ICAL.Component[] }>();
  const orphans: ICAL.Component[] = [];
  for (const vevent of root.getAllSubcomponents("vevent")) {
    const uid = String(vevent.getFirstPropertyValue("uid") ?? "");
    if (!uid) {
      orphans.push(vevent);
      continue;
    }
    const g = groups.get(uid) ?? { exceptions: [] };
    if (vevent.hasProperty("recurrence-id")) g.exceptions.push(vevent);
    else g.master = vevent;
    groups.set(uid, g);
  }
  const events: InstanceType<typeof ICAL.Event>[] = orphans.map((c) => new ICAL.Event(c, { exceptions: [] }));
  for (const g of groups.values()) {
    if (g.master) events.push(new ICAL.Event(g.master, { exceptions: g.exceptions }));
    // 没有主事件的例外按单次事件处理
    else for (const c of g.exceptions) events.push(new ICAL.Event(c, { exceptions: [] }));
  }

  for (const ev of events) {
    if (!ev.startDate) continue;
    if (!ev.isRecurring()) {
      const s = ev.startDate.toJSDate();
      const e = ev.endDate ? ev.endDate.toJSDate() : s;
      push(ev.summary ?? "", ev.location ?? "", s, e);
      continue;
    }

    const it = ev.iterator();
    for (let i = 0, next = it.next(); next && i < MAX_ITERATIONS; i++, next = it.next()) {
      const d = ev.getOccurrenceDetails(next);
      const s = d.startDate.toJSDate();
      if (s.getTime() >= endMs) break;
      push(d.item.summary ?? "", d.item.location ?? "", s, d.endDate.toJSDate());
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function normalizeIcsUrl(url: string): string {
  return url.trim().replace(/^webcals?:\/\//i, "https://");
}
