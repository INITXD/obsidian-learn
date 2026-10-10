import { ItemView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { formatDate, formatTime } from "../core/dates.ts";
import { format, t, type Lang } from "../i18n.ts";
import type { Candidate } from "../courses.ts";
import type { Turn } from "../llm/types.ts";
import type CourseTutorPlugin from "../main.ts";
import { loadMaterials } from "../materials.ts";
import { materialLabels, materialText, noteText, reportRequest, reviewSystem } from "../prompts.ts";
import { confirmModal } from "./confirm.ts";
import { CoursePicker, type PickerState } from "./coursePicker.ts";

export const REVIEW_VIEW_TYPE = "course-tutor-review";

interface Session {
  course: string;
  /** 会话开始时的输出语言；中途改设置不影响本次会话 */
  lang: Lang;
  date: string;
  turns: Turn[];
  /** 当时实际用作学生笔记的文件，报告写回第一份 */
  lectureFiles: TFile[];
}

interface ChatEntry {
  role: "user" | "assistant" | "system";
  text: string;
}

export class ReviewView extends ItemView {
  private picker!: CoursePicker;
  private state: PickerState = { course: "", date: formatDate(new Date()) };
  private selection = new Map<string, boolean>();
  private session: Session | null = null;
  private log: ChatEntry[] = [];
  private busy = false;

  private materialsEl!: HTMLElement;
  private chatEl!: HTMLElement;
  private composerEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private plugin: CourseTutorPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return REVIEW_VIEW_TYPE;
  }
  getDisplayText(): string {
    return t("view.review");
  }
  getIcon(): string {
    return "search-check";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("ct-review");
    this.picker = new CoursePicker(this.plugin, root.createDiv(), this.state, () => this.renderMaterials());
    this.picker.render();
    this.materialsEl = root.createDiv("ct-materials");
    this.chatEl = root.createDiv("ct-chat");
    this.composerEl = root.createDiv("ct-composer");
    this.renderMaterials();
    this.renderComposer();
  }

  /** 从拍照弹窗跳转时预设课程和日期 */
  setTarget(target: PickerState): void {
    this.state.course = target.course;
    this.state.date = target.date;
    this.picker.render();
    this.renderMaterials();
  }

  private key(f: TFile): string {
    return f.path;
  }

  private renderMaterials(): void {
    const el = this.materialsEl;
    el.empty();
    const { course, date } = this.state;
    if (!course) {
      el.createDiv({ cls: "ct-muted", text: t("review.chooseCourse") });
      return;
    }
    const repo = this.plugin.repo;
    const lecture = repo.lectureNotesFor(course, date).map((file) => ({ file, suggested: true }));
    const courseNotes = repo.courseNoteCandidates(course, date);
    const professor = repo.professorCandidates(course, date);

    this.renderGroup(el, t("mat.student"), lecture, t("review.noLecture", { folder: repo.lectureFolder(course) }));
    this.renderGroup(el, t("mat.courseNote"), courseNotes, t("review.noCourseNote", { path: `${repo.courseFolder(course)}/${this.plugin.settings.courseNotePath}` }));
    this.renderGroup(el, t("mat.professor"), professor, t("review.noProfessor"), true);

    if (!professor.some((c) => c.suggested)) {
      const warn = el.createDiv("ct-warning");
      warn.createSpan({
        text: t("review.missingProfessor", { date, folder: repo.professorFolder(course) }),
      });
      warn.createEl("button", { text: t("review.rescan") }).addEventListener("click", () => this.renderMaterials());
    }

    const actions = el.createDiv("ct-actions");
    const start = actions.createEl("button", { text: this.session ? t("review.restart") : t("review.start"), cls: "mod-cta" });
    start.disabled = this.busy;
    start.addEventListener("click", () => void this.start());
  }

  private renderGroup(parent: HTMLElement, label: string, items: Candidate[], emptyText: string, tagToday = false): void {
    const group = parent.createDiv("ct-group");
    group.createDiv({ cls: "ct-group-title", text: label });
    if (items.length === 0) {
      group.createDiv({ cls: "ct-muted", text: emptyText });
      return;
    }
    for (const { file, suggested } of items) {
      const k = this.key(file);
      if (!this.selection.has(k)) this.selection.set(k, suggested);
      const row = group.createEl("label", { cls: "ct-file" });
      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = this.selection.get(k)!;
      cb.addEventListener("change", () => this.selection.set(k, cb.checked));
      row.createSpan({ text: file.name });
      if (suggested && tagToday) row.createSpan({ cls: "ct-tag", text: t("review.todayTag") });
    }
  }

  private selected(items: Candidate[]): TFile[] {
    return items.filter((c) => this.selection.get(this.key(c.file))).map((c) => c.file);
  }

  private async start(): Promise<void> {
    const { course, date } = this.state;
    const repo = this.plugin.repo;
    const lectureFiles = this.selected(repo.lectureNotesFor(course, date).map((file) => ({ file, suggested: true })));
    const courseNoteFiles = this.selected(repo.courseNoteCandidates(course, date));
    const professorFiles = this.selected(repo.professorCandidates(course, date));
    if (
      lectureFiles.length === 0 &&
      !(await confirmModal(this.app, t("review.confirmNoLecture")))
    ) return;

    this.session = null;
    this.log = [];
    this.renderChat();
    await this.run(async () => {
      this.pushLog("system", t("review.loading"));
      const lang = this.plugin.outputLang();
      const labels = materialLabels(lang);
      const text = materialText(lang);
      const m = await loadMaterials(this.app, this.plugin.settings, lang, [
        { label: labels.student, uiLabel: t("mat.student"), files: lectureFiles, missingNote: text.missing },
        { label: labels.courseNote, uiLabel: t("mat.courseNote"), files: courseNoteFiles, missingNote: text.missing },
        { label: labels.professor, uiLabel: t("mat.professor"), files: professorFiles, missingNote: text.missingProfessor },
      ]);
      this.log.pop();
      this.pushLog("system", `${t("review.sent")}\n- ${m.summary.join("\n- ")}${m.warnings.length ? `\n\n⚠️ ${m.warnings.join("\n⚠️ ")}` : ""}`);
      this.session = {
        course,
        date,
        lang,
        lectureFiles,
        turns: [{ role: "user", parts: [...m.parts, { type: "text", text: text.start }] }],
      };
      await this.ask();
    });
    this.renderMaterials();
  }

  private async ask(): Promise<string> {
    const s = this.session!;
    const res = await this.plugin.createClient().complete({
      system: reviewSystem(s.lang, s.course, s.date),
      turns: s.turns,
      maxTokens: 16000,
      cacheFirstTurn: true,
    });
    s.turns.push({ role: "assistant", parts: [{ type: "text", text: res.text }], raw: res.raw });
    this.pushLog("assistant", res.text + (res.truncated ? `\n\n> [!warning] ${t("review.replyTruncated")}` : ""));
    return res.text;
  }

  private async send(text: string): Promise<void> {
    if (!this.session || !text.trim()) return;
    const s = this.session;
    const before = s.turns.length;
    s.turns.push({ role: "user", parts: [{ type: "text", text }] });
    this.pushLog("user", text);
    // 请求失败时撤回这一轮，保证对话历史只包含成功的轮次
    await this.run(() => this.ask().then(() => undefined), () => (s.turns.length = before));
  }

  private async report(): Promise<void> {
    const s = this.session;
    if (!s) return;
    const before = s.turns.length;
    s.turns.push({ role: "user", parts: [{ type: "text", text: reportRequest(s.lang) }] });
    const generating = t("review.generatingReport");
    this.pushLog("system", generating);
    await this.run(
      async () => {
        const reportText = await this.ask();
        this.log = this.log.filter((e) => e.text !== generating);
        const nt = noteText(s.lang);
        const target = await this.reportTarget(s);
        const transcript = this.log
          .filter((e) => e.role !== "system")
          .slice(0, -1)
          .map((e) => `**${e.role === "user" ? nt.me : nt.tutor}**: ${e.text}`)
          .join("\n\n");
        const quoted = transcript.split("\n").map((l) => `> ${l}`).join("\n");
        await this.app.vault.append(
          target,
          `\n\n## ${format(nt.report, { time: formatTime(new Date()) })}\n\n${reportText}\n\n> [!quote]- ${nt.transcript}\n${quoted}\n`,
        );
        this.pushLog("system", t("review.reportWritten", { path: target.path }));
        new Notice(t("review.reportWritten", { path: target.path }));
      },
      () => (s.turns.length = before),
    );
  }

  private async reportTarget(s: Session): Promise<TFile> {
    if (s.lectureFiles[0]) return s.lectureFiles[0];
    const repo = this.plugin.repo;
    const path = repo.lectureNotePath(s.course, s.date);
    const existing = this.app.vault.getFileByPath(path);
    if (existing) return existing;
    await repo.ensureFolder(repo.lectureFolder(s.course));
    return this.app.vault.create(path, `---\ncourse: "${s.course}"\ndate: ${s.date}\ntype: lecture-note\n---\n\n# ${s.date} ${s.course}\n`);
  }

  /** 进度提示：请求失败时从对话中移除 */
  private get pending(): Set<string> {
    return new Set([t("review.loading"), t("review.generatingReport")]);
  }

  private async run(fn: () => Promise<void>, onError?: () => void): Promise<void> {
    this.busy = true;
    this.renderComposer();
    try {
      await fn();
    } catch (e) {
      onError?.();
      const last = this.log[this.log.length - 1];
      if (last?.role === "system" && this.pending.has(last.text)) this.log.pop();
      this.pushLog("system", `❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.busy = false;
      this.renderComposer();
    }
  }

  private pushLog(role: ChatEntry["role"], text: string): void {
    this.log.push({ role, text });
    this.renderChat();
  }

  private renderChat(): void {
    const el = this.chatEl;
    el.empty();
    const sourcePath = this.session?.lectureFiles[0]?.path ?? "";
    for (const entry of this.log) {
      const bubble = el.createDiv(`ct-msg ct-msg-${entry.role}`);
      void MarkdownRenderer.render(this.app, entry.text, bubble, sourcePath, this);
    }
    if (this.busy) el.createDiv({ cls: "ct-muted", text: t("review.waiting") });
    el.scrollTop = el.scrollHeight;
  }

  private renderComposer(): void {
    const el = this.composerEl;
    if (!el) return;
    el.empty();
    this.renderChat();
    if (!this.session) return;
    const input = el.createEl("textarea", { attr: { rows: "3", placeholder: t("review.inputPlaceholder") } });
    input.disabled = this.busy;
    const actions = el.createDiv("ct-actions");
    const send = actions.createEl("button", { text: t("review.send"), cls: "mod-cta" });
    const reportBtn = actions.createEl("button", { text: t("review.report") });
    send.disabled = reportBtn.disabled = this.busy;
    const submit = () => {
      const text = input.value;
      input.value = "";
      void this.send(text);
    };
    send.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
      }
    });
    reportBtn.addEventListener("click", () => void this.report());
    if (!this.busy) input.focus();
  }
}
