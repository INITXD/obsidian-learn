import { Modal, Notice, Platform, TFile } from "obsidian";
import { formatDate, formatTime } from "../core/dates.ts";
import type CourseTutorPlugin from "../main.ts";
import { imageToJpeg, type EncodedImage } from "../media.ts";
import { TRANSCRIBE_SYSTEM, transcribeUserText } from "../prompts.ts";
import { CoursePicker } from "./coursePicker.ts";

interface Photo {
  image: EncodedImage;
  previewUrl: string;
}

export class CaptureModal extends Modal {
  private photos: Photo[] = [];
  private picker!: CoursePicker;
  private extra = "";
  private busy = false;
  private thumbsEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private generateBtn!: HTMLButtonElement;

  constructor(private plugin: CourseTutorPlugin) {
    super(plugin.app);
  }

  onOpen(): void {
    this.modalEl.addClass("ct-modal");
    this.titleEl.setText("拍照整理课堂笔记");
    const { contentEl } = this;

    this.picker = new CoursePicker(
      this.plugin,
      contentEl.createDiv(),
      { course: "", date: formatDate(new Date()) },
      () => this.updateButton(),
    );
    this.picker.render();

    const photoRow = contentEl.createDiv("ct-row ct-photo-buttons");
    this.addFileButton(photoRow, "拍照", true);
    this.addFileButton(photoRow, Platform.isMobile ? "从相册选择" : "选择图片", false);
    this.thumbsEl = contentEl.createDiv("ct-thumbs");

    const extra = contentEl.createEl("textarea", {
      cls: "ct-extra",
      attr: { placeholder: "补充说明（可选），例如：第 3 张是黑板照片；符号 ⊕ 表示异或", rows: "2" },
    });
    extra.addEventListener("input", () => (this.extra = extra.value));

    this.statusEl = contentEl.createDiv("ct-status");
    const actions = contentEl.createDiv("ct-actions");
    this.generateBtn = actions.createEl("button", { text: "生成笔记", cls: "mod-cta" });
    this.generateBtn.addEventListener("click", () => void this.generate());
    this.updateButton();
  }

  onClose(): void {
    for (const p of this.photos) URL.revokeObjectURL(p.previewUrl);
    this.contentEl.empty();
  }

  private addFileButton(parent: HTMLElement, label: string, capture: boolean): void {
    // 桌面端浏览器会忽略 capture 属性，两个按钮行为相同，只保留一个
    if (capture && !Platform.isMobile) return;
    const input = parent.createEl("input", { type: "file", attr: { accept: "image/*" } });
    input.addClass("ct-hidden");
    if (capture) input.setAttr("capture", "environment");
    else input.multiple = true;
    const btn = parent.createEl("button", { text: label });
    btn.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const files = Array.from(input.files ?? []);
      input.value = "";
      for (const f of files) {
        try {
          const image = await imageToJpeg(f, this.plugin.settings.maxImageEdge);
          this.photos.push({ image, previewUrl: URL.createObjectURL(new Blob([image.bytes], { type: "image/jpeg" })) });
        } catch (e) {
          new Notice(`${f.name}：${e instanceof Error ? e.message : e}`);
        }
      }
      this.renderThumbs();
    });
  }

  private renderThumbs(): void {
    this.thumbsEl.empty();
    this.photos.forEach((p, i) => {
      const t = this.thumbsEl.createDiv("ct-thumb");
      t.createEl("img", { attr: { src: p.previewUrl } });
      t.createSpan({ cls: "ct-thumb-index", text: String(i + 1) });
      const controls = t.createDiv("ct-thumb-controls");
      if (i > 0) {
        controls.createEl("button", { text: "←" }).addEventListener("click", () => {
          [this.photos[i - 1], this.photos[i]] = [this.photos[i], this.photos[i - 1]];
          this.renderThumbs();
        });
      }
      controls.createEl("button", { text: "×" }).addEventListener("click", () => {
        URL.revokeObjectURL(p.previewUrl);
        this.photos.splice(i, 1);
        this.renderThumbs();
      });
    });
    this.updateButton();
  }

  private updateButton(): void {
    if (!this.generateBtn) return;
    this.generateBtn.disabled = this.busy || !this.picker.state.course || this.photos.length === 0;
  }

  private async generate(): Promise<void> {
    const { course, date } = this.picker.state;
    this.busy = true;
    this.updateButton();
    this.statusEl.setText(`正在识别 ${this.photos.length} 张照片…`);
    try {
      const llm = this.plugin.createClient();
      const res = await llm.complete({
        system: TRANSCRIBE_SYSTEM,
        maxTokens: 16000,
        turns: [
          {
            role: "user",
            parts: [
              ...this.photos.flatMap((p, i) => [{ type: "text" as const, text: `照片 ${i + 1}：` }, p.image.part]),
              { type: "text", text: transcribeUserText(course, date, this.photos.length, this.extra) },
            ],
          },
        ],
      });
      if (!res.text) throw new Error("模型没有返回内容");

      this.statusEl.setText("正在写入笔记…");
      const file = await this.writeNote(course, date, res.text, res.truncated);
      this.showResult(course, date, file, res.truncated);
    } catch (e) {
      this.statusEl.empty();
      this.statusEl.createDiv({ cls: "ct-error", text: `失败：${e instanceof Error ? e.message : e}` });
    } finally {
      this.busy = false;
      this.updateButton();
    }
  }

  private async writeNote(course: string, date: string, body: string, truncated: boolean): Promise<TFile> {
    const repo = this.plugin.repo;
    const embeds: string[] = [];
    if (this.plugin.settings.saveOriginalPhotos) {
      const folder = repo.attachmentFolder(course);
      await repo.ensureFolder(folder);
      for (let i = 0; i < this.photos.length; i++) {
        const path = repo.uniquePath(folder, `${date} ${course} ${i + 1}`, "jpg");
        const f = await this.app.vault.createBinary(path, this.photos[i].image.bytes);
        embeds.push(f.path);
      }
    }
    const truncatedNote = truncated ? "\n\n> [!warning] 输出达到长度上限被截断，后面的照片内容可能缺失。\n" : "";
    const photosBlock = embeds.length
      ? `\n\n> [!info]- 原始照片\n${embeds.map((p) => `> ![[${p}]]`).join("\n")}\n`
      : "";

    const notePath = repo.lectureNotePath(course, date);
    const existing = this.app.vault.getFileByPath(notePath);
    if (existing) {
      // 同一天多次拍照：追加，不覆盖
      const section = `\n\n## 补充（${formatTime(new Date())}）\n\n${body}${truncatedNote}${photosBlock}`;
      await this.app.vault.append(existing, section);
      return existing;
    }
    await repo.ensureFolder(repo.lectureFolder(course));
    const frontmatter = [
      "---",
      `course: "${course.replace(/"/g, '\\"')}"`,
      `date: ${date}`,
      "type: lecture-note",
      "source: photo",
      "---",
      "",
      `# ${date} ${course}`,
      "",
    ].join("\n");
    return this.app.vault.create(notePath, `${frontmatter}${body}${truncatedNote}${photosBlock}`);
  }

  private showResult(course: string, date: string, file: TFile, truncated: boolean): void {
    const el = this.statusEl;
    el.empty();
    el.createDiv({ cls: "ct-success", text: `已写入 ${file.path}` });
    if (truncated) el.createDiv({ cls: "ct-warning", text: "输出被截断，建议减少单次照片数量后补拍。" });

    const hasProfessorNotes = this.plugin.repo.professorCandidates(course, date).some((c) => c.suggested);
    if (!hasProfessorNotes) {
      const msg = `未找到 ${date} 的教授笔记，请上传到 ${this.plugin.repo.professorFolder(course)}`;
      el.createDiv({ cls: "ct-warning", text: msg });
      new Notice(msg, 10000);
    }

    this.photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    this.photos = [];
    this.renderThumbs();

    const actions = el.createDiv("ct-actions");
    actions.createEl("button", { text: "打开笔记" }).addEventListener("click", () => {
      void this.app.workspace.getLeaf(false).openFile(file);
      this.close();
    });
    actions.createEl("button", { text: "开始查漏", cls: "mod-cta" }).addEventListener("click", () => {
      this.close();
      void this.plugin.openReview({ course, date });
    });
  }
}
