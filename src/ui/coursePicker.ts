import { setIcon } from "obsidian";
import { formatDate, formatTime } from "../core/dates.ts";
import { t } from "../i18n.ts";
import type CourseTutorPlugin from "../main.ts";
import type { CourseEvent } from "../calendar.ts";

export interface PickerState {
  course: string;
  date: string;
}

/** 日期 + 当天课表 + 课程下拉框。课表只作为候选，最终以下拉框选择为准。 */
export class CoursePicker {
  private eventsEl!: HTMLElement;
  private select!: HTMLSelectElement;

  constructor(
    private plugin: CourseTutorPlugin,
    private container: HTMLElement,
    public state: PickerState,
    private onChange: () => void,
  ) {}

  render(): void {
    const c = this.container;
    c.empty();
    c.addClass("ct-picker");

    const dateRow = c.createDiv("ct-row");
    dateRow.createSpan({ text: t("picker.date") });
    const dateInput = dateRow.createEl("input", { type: "date", value: this.state.date });
    dateInput.addEventListener("change", () => {
      if (!dateInput.value) return;
      this.state.date = dateInput.value;
      void this.loadEvents(false);
      this.onChange();
    });
    const todayBtn = dateRow.createEl("button", { text: t("picker.today") });
    todayBtn.addEventListener("click", () => {
      this.state.date = dateInput.value = formatDate(new Date());
      void this.loadEvents(false);
      this.onChange();
    });

    this.eventsEl = c.createDiv("ct-events");

    const courseRow = c.createDiv("ct-row");
    courseRow.createSpan({ text: t("picker.course") });
    this.select = courseRow.createEl("select", { cls: "dropdown" });
    const courses = this.plugin.repo.listCourses();
    this.select.createEl("option", { text: courses.length ? t("picker.chooseCourse") : t("picker.noCourses"), value: "" });
    for (const name of courses) this.select.createEl("option", { text: name, value: name });
    this.select.value = this.state.course;
    this.select.addEventListener("change", () => this.setCourse(this.select.value));

    void this.loadEvents(false);
  }

  private setCourse(course: string): void {
    this.state.course = course;
    this.select.value = course;
    this.eventsEl.querySelectorAll(".ct-event").forEach((el) => {
      el.toggleClass("is-selected", (el as HTMLElement).dataset.course === course && !!course);
    });
    this.onChange();
  }

  private async loadEvents(force: boolean): Promise<void> {
    const el = this.eventsEl;
    el.empty();
    if (!this.plugin.settings.icsUrl) {
      el.createDiv({ cls: "ct-muted", text: t("picker.noIcs") });
      return;
    }
    const header = el.createDiv("ct-row ct-events-header");
    header.createSpan({ text: t("picker.timetable", { date: this.state.date }) });
    const refresh = header.createEl("button", { cls: "clickable-icon", attr: { "aria-label": t("picker.refresh") } });
    setIcon(refresh, "refresh-cw");
    refresh.addEventListener("click", () => void this.loadEvents(true));
    const list = el.createDiv({ cls: "ct-muted", text: t("picker.loading") });

    const date = this.state.date;
    const { events, error, stale } = await this.plugin.calendar.eventsOn(date, force);
    if (date !== this.state.date) return;
    list.remove();
    if (error) {
      el.createDiv({ cls: "ct-warning", text: t("picker.loadFailed", { error }) });
      return;
    }
    if (stale) el.createDiv({ cls: "ct-warning", text: t("picker.stale") });
    if (events.length === 0) {
      el.createDiv({ cls: "ct-muted", text: t("picker.noEvents") });
      return;
    }
    for (const ev of events) this.renderEvent(el, ev);

    if (!this.state.course) {
      const suggested = this.suggest(events);
      if (suggested) this.setCourse(suggested);
    }
  }

  private renderEvent(parent: HTMLElement, ev: CourseEvent): void {
    const item = parent.createDiv("ct-event");
    item.dataset.course = ev.course ?? "";
    item.createSpan({ cls: "ct-event-time", text: `${formatTime(ev.start)}–${formatTime(ev.end)}` });
    item.createSpan({ cls: "ct-event-title", text: ev.summary + (ev.location ? `（${ev.location}）` : "") });
    if (ev.course) {
      item.createSpan({ cls: "ct-event-course", text: `→ ${ev.course}` });
      item.addClass("is-clickable");
      item.toggleClass("is-selected", ev.course === this.state.course);
      item.addEventListener("click", () => this.setCourse(ev.course!));
    } else {
      item.addClass("is-unmatched");
      item.setAttr("title", t("picker.unmatched"));
    }
  }

  /** 只在查看今天时，预选正在进行或最近结束的课程 */
  private suggest(events: CourseEvent[]): string | null {
    if (this.state.date !== formatDate(new Date())) return null;
    const now = Date.now();
    const started = events.filter((e) => e.course && e.start.getTime() <= now);
    return started.length ? started[started.length - 1].course : null;
  }
}
