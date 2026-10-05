import { test } from "node:test";
import assert from "node:assert/strict";
import { nameMatchesDate, dayRange } from "../src/core/dates.ts";
import { parseAliases, matchCourse } from "../src/core/aliases.ts";
import { eventsInRange } from "../src/core/ics.ts";

test("nameMatchesDate 识别常见日期写法并避免数字误匹配", () => {
  assert.ok(nameMatchesDate("Lecture 2026-10-05.pdf", "2026-10-05"));
  assert.ok(nameMatchesDate("L5_20261005.pdf", "2026-10-05"));
  assert.ok(nameMatchesDate("10月5日 讲义.pdf", "2026-10-05"));
  assert.ok(nameMatchesDate("slides 10.5.pdf", "2026-10-05"));
  assert.ok(!nameMatchesDate("slides 110.52.pdf", "2026-10-05"));
  assert.ok(!nameMatchesDate("2026-10-06.pdf", "2026-10-05"));
});

test("matchCourse 使用文件夹名和别名，关键词最长者优先", () => {
  const aliases = parseAliases("线性代数 = Linear Algebra, MATH 221\n# 注释\n概率论 = 概率");
  const courses = ["线性代数", "概率论", "数理统计"];
  assert.equal(matchCourse("MATH 221 Lecture (Room 101)", courses, aliases), "线性代数");
  assert.equal(matchCourse("概率论与数理统计", courses, aliases), "数理统计");
  assert.equal(matchCourse("社团活动", courses, aliases), null);
});

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:test
BEGIN:VEVENT
UID:la@test
DTSTART:20260907T010000Z
DTEND:20260907T024000Z
RRULE:FREQ=WEEKLY;UNTIL=20261231T000000Z
EXDATE:20260928T010000Z
SUMMARY:MATH 221 Linear Algebra
LOCATION:Room 101
END:VEVENT
BEGIN:VEVENT
UID:la@test
RECURRENCE-ID:20261005T010000Z
DTSTART:20261005T050000Z
DTEND:20261005T064000Z
SUMMARY:MATH 221 Linear Algebra (调课)
END:VEVENT
BEGIN:VEVENT
UID:once@test
DTSTART:20261005T080000Z
DTEND:20261005T090000Z
SUMMARY:班会
END:VEVENT
END:VCALENDAR`;

test("eventsInRange 展开周重复、EXDATE 和调课例外", () => {
  const utc = (s: string) => new Date(s);
  const oct5 = eventsInRange(ICS, utc("2026-10-05T00:00:00Z"), utc("2026-10-06T00:00:00Z"));
  assert.deepEqual(oct5.map((e) => e.summary), ["MATH 221 Linear Algebra (调课)", "班会"]);
  assert.equal(oct5[0].start.toISOString(), "2026-10-05T05:00:00.000Z");
  const sep28 = eventsInRange(ICS, utc("2026-09-28T00:00:00Z"), utc("2026-09-29T00:00:00Z"));
  assert.equal(sep28.length, 0);
  const oct12 = eventsInRange(ICS, utc("2026-10-12T00:00:00Z"), utc("2026-10-13T00:00:00Z"));
  assert.equal(oct12.length, 1);
  assert.equal(oct12[0].location, "Room 101");
});

test("dayRange 返回本地当天区间", () => {
  const { start, end } = dayRange("2026-10-05");
  assert.equal(end.getTime() - start.getTime(), 24 * 3600 * 1000);
});
