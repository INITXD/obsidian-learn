import { ItemView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { formatDate, formatTime } from "../core/dates.ts";
import type { Candidate } from "../courses.ts";
import type { Turn } from "../llm/types.ts";
import type CourseTutorPlugin from "../main.ts";
import { loadMaterials } from "../materials.ts";
import { REPORT_REQUEST, reviewSystem } from "../prompts.ts";
import { CoursePicker, type PickerState } from "./coursePicker.ts";

export const REVIEW_VIEW_TYPE = "course-tutor-review";

interface Session {
  course: string;
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
    return "课程查漏";
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
      el.createDiv({ cls: "ct-muted", text: "选择课程后显示资料。" });
      return;
    }
    const repo = this.plugin.repo;
    const lecture = repo.lectureNotesFor(course, date).map((file) => ({ file, suggested: true }));
    const courseNotes = repo.courseNoteCandidates(course, date);
    const professor = repo.professorCandidates(course, date);

    this.renderGroup(el, "学生笔记", lecture, `当天没有课堂笔记（${repo.lectureFolder(course)}）。请先拍照生成。`);
    this.renderGroup(el, "课程笔记", courseNotes, `未找到 Course Note（${repo.courseFolder(course)}/${this.plugin.settings.courseNotePath}）。`);
    this.renderGroup(el, "教授笔记", professor, "教授笔记文件夹为空。");

    if (!professor.some((c) => c.suggested)) {
      const warn = el.createDiv("ct-warning");
      warn.createSpan({
        text: `未找到 ${date} 的教授笔记。请上传到 ${repo.professorFolder(course)}（文件名包含日期最可靠），然后重新扫描。也可以手动勾选其他文件，或直接开始（对照可信度较低）。`,
      });
      warn.createEl("button", { text: "重新扫描" }).addEventListener("click", () => this.renderMaterials());
    }

    const actions = el.createDiv("ct-actions");
    const start = actions.createEl("button", { text: this.session ? "用当前资料重新开始" : "开始查漏", cls: "mod-cta" });
    start.disabled = this.busy;
    start.addEventListener("click", () => void this.start());
  }

  private renderGroup(parent: HTMLElement, label: string, items: Candidate[], emptyText: string): void {
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
      if (suggested && label === "教授笔记") row.createSpan({ cls: "ct-tag", text: "当天" });
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
    if (lectureFiles.length === 0 && !confirm("没有勾选学生笔记，模型只能凭对话判断你的掌握情况。继续？")) return;

    this.session = null;
    this.log = [];
    this.renderChat();
    await this.run(async () => {
      this.pushLog("system", "正在加载资料（PDF 会逐页转成图片）…");
      const m = await loadMaterials(this.app, this.plugin.settings, [
        { label: "学生笔记", files: lectureFiles, missingNote: "未提供。" },
        { label: "课程笔记", files: courseNoteFiles, missingNote: "未提供。" },
        { label: "教授笔记", files: professorFiles, missingNote: "未提供。对照只能基于课程笔记和学科常识，请在回复中说明可信度较低。" },
      ]);
      this.log.pop();
      this.pushLog("system", `已发送资料：\n- ${m.summary.join("\n- ")}${m.warnings.length ? `\n\n⚠️ ${m.warnings.join("\n⚠️ ")}` : ""}`);
      this.session = {
        course,
        date,
        lectureFiles,
        turns: [{ role: "user", parts: [...m.parts, { type: "text", text: "资料如上，请开始。" }] }],
      };
      await this.ask();
    });
    this.renderMaterials();
  }

  private async ask(): Promise<string> {
    const s = this.session!;
    const res = await this.plugin.createClient().complete({
      system: reviewSystem(s.course, s.date),
      turns: s.turns,
      maxTokens: 16000,
      cacheFirstTurn: true,
    });
    s.turns.push({ role: "assistant", parts: [{ type: "text", text: res.text }], raw: res.raw });
    this.pushLog("assistant", res.text + (res.truncated ? "\n\n> [!warning] 回复达到长度上限被截断。" : ""));
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
    s.turns.push({ role: "user", parts: [{ type: "text", text: REPORT_REQUEST }] });
    this.pushLog("system", "正在生成查漏报告…");
    await this.run(
      async () => {
        const reportText = await this.ask();
        this.log = this.log.filter((e) => e.text !== "正在生成查漏报告…");
        const target = await this.reportTarget(s);
        const transcript = this.log
          .filter((e) => e.role !== "system")
          .slice(0, -1)
          .map((e) => `**${e.role === "user" ? "我" : "助教"}**：${e.text}`)
          .join("\n\n");
        const quoted = transcript.split("\n").map((l) => `> ${l}`).join("\n");
        await this.app.vault.append(
          target,
          `\n\n## 查漏报告（${formatTime(new Date())}）\n\n${reportText}\n\n> [!quote]- 对话记录\n${quoted}\n`,
        );
        this.pushLog("system", `报告已写入 ${target.path}`);
        new Notice(`查漏报告已写入 ${target.path}`);
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

  private async run(fn: () => Promise<void>, onError?: () => void): Promise<void> {
    this.busy = true;
    this.renderComposer();
    try {
      await fn();
    } catch (e) {
      onError?.();
      const last = this.log[this.log.length - 1];
      if (last?.role === "system" && last.text.startsWith("正在")) this.log.pop();
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
    if (this.busy) el.createDiv({ cls: "ct-muted", text: "等待模型回复…" });
    el.scrollTop = el.scrollHeight;
  }

  private renderComposer(): void {
    const el = this.composerEl;
    if (!el) return;
    el.empty();
    this.renderChat();
    if (!this.session) return;
    const input = el.createEl("textarea", { attr: { rows: "3", placeholder: "回答问题，或提出你的疑问（Ctrl/Cmd+Enter 发送）" } });
    input.disabled = this.busy;
    const actions = el.createDiv("ct-actions");
    const send = actions.createEl("button", { text: "发送", cls: "mod-cta" });
    const reportBtn = actions.createEl("button", { text: "生成报告并写入笔记" });
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
