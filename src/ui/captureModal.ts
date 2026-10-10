import { Modal, Notice, TFile } from "obsidian";
import { formatDate, formatTime } from "../core/dates.ts";
import { format, t } from "../i18n.ts";
import type CourseTutorPlugin from "../main.ts";
import { ACCEPT, VaultMediaPicker, fileToPages, vaultFileToBlob, type NamedBlob } from "../inputs.ts";
import type { EncodedImage } from "../media.ts";
import { canCaptureFromCamera, deviceKind, supportsDragAndDrop } from "../platform.ts";
import { noteText, photoLabel, transcribeSystem, transcribeUserText } from "../prompts.ts";
import { CoursePicker } from "./coursePicker.ts";

interface Photo {
  image: EncodedImage;
  label: string;
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
    this.titleEl.setText(t("capture.title"));
    const { contentEl } = this;

    this.picker = new CoursePicker(
      this.plugin,
      contentEl.createDiv(),
      { course: "", date: formatDate(new Date()) },
      () => this.updateButton(),
    );
    this.picker.render();

    const photoRow = contentEl.createDiv("ct-row ct-photo-buttons");
    if (canCaptureFromCamera()) this.addFileButton(photoRow, t("capture.camera"), true);
    this.addFileButton(photoRow, deviceKind() === "desktop" ? t("capture.chooseFiles") : t("capture.photosOrFiles"), false);
    photoRow.createEl("button", { text: t("capture.fromVault") }).addEventListener("click", () =>
      new VaultMediaPicker(this.app, (f) => void vaultFileToBlob(this.app, f).then((b) => this.addFiles([b]))).open(),
    );
    if (supportsDragAndDrop()) {
      contentEl.createDiv({ cls: "ct-muted", text: t("capture.dropHint") });
      this.registerDrop(this.modalEl);
    }
    this.modalEl.addEventListener("paste", (e) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        void this.addFiles(files);
      }
    });
    this.thumbsEl = contentEl.createDiv("ct-thumbs");

    const extra = contentEl.createEl("textarea", {
      cls: "ct-extra",
      attr: { placeholder: t("capture.extraPlaceholder"), rows: "2" },
    });
    extra.addEventListener("input", () => (this.extra = extra.value));

    this.statusEl = contentEl.createDiv("ct-status");
    const actions = contentEl.createDiv("ct-actions");
    this.generateBtn = actions.createEl("button", { text: t("capture.generate"), cls: "mod-cta" });
    this.generateBtn.addEventListener("click", () => void this.generate());
    this.updateButton();
  }

  onClose(): void {
    for (const p of this.photos) URL.revokeObjectURL(p.previewUrl);
    this.contentEl.empty();
  }

  private addFileButton(parent: HTMLElement, label: string, capture: boolean): void {
    const input = parent.createEl("input", { type: "file", attr: { accept: capture ? "image/*" : ACCEPT } });
    input.addClass("ct-hidden");
    if (capture) input.setAttr("capture", "environment");
    else input.multiple = true;
    const btn = parent.createEl("button", { text: label, cls: capture ? "mod-cta" : "" });
    btn.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      input.value = "";
      void this.addFiles(files);
    });
  }

  private registerDrop(target: HTMLElement): void {
    target.addEventListener("dragover", (e) => {
      e.preventDefault();
      target.addClass("ct-dragover");
    });
    target.addEventListener("dragleave", () => target.removeClass("ct-dragover"));
    target.addEventListener("drop", (e) => {
      e.preventDefault();
      target.removeClass("ct-dragover");
      void this.addFiles(Array.from(e.dataTransfer?.files ?? []));
    });
  }

  private async addFiles(files: NamedBlob[]): Promise<void> {
    for (const f of files) {
      this.statusEl.setText(t("capture.processing", { name: f.name }));
      try {
        const { pages, warning } = await fileToPages(f, this.plugin.settings);
        for (const p of pages) {
          this.photos.push({
            image: p.image,
            label: p.label,
            previewUrl: URL.createObjectURL(new Blob([p.image.bytes], { type: "image/jpeg" })),
          });
        }
        if (warning) new Notice(warning, 8000);
      } catch (e) {
        new Notice(`${f.name}：${e instanceof Error ? e.message : e}`);
      }
      this.renderThumbs();
    }
    this.statusEl.setText("");
  }

  private renderThumbs(): void {
    this.thumbsEl.empty();
    this.photos.forEach((p, i) => {
      const t = this.thumbsEl.createDiv("ct-thumb");
      t.createEl("img", { attr: { src: p.previewUrl, title: p.label } });
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
    this.statusEl.setText(t("capture.recognizing", { count: this.photos.length }));
    const lang = this.plugin.outputLang();
    try {
      const llm = this.plugin.createClient();
      const res = await llm.complete({
        system: transcribeSystem(lang),
        maxTokens: 16000,
        turns: [
          {
            role: "user",
            parts: [
              ...this.photos.flatMap((p, i) => [{ type: "text" as const, text: photoLabel(lang, i + 1, p.label) }, p.image.part]),
              { type: "text", text: transcribeUserText(lang, course, date, this.photos.length, this.extra) },
            ],
          },
        ],
      });
      if (!res.text) throw new Error(t("error.emptyResponse"));

      this.statusEl.setText(t("capture.writing"));
      const file = await this.writeNote(course, date, res.text, res.truncated);
      this.showResult(course, date, file, res.truncated);
    } catch (e) {
      this.statusEl.empty();
      this.statusEl.createDiv({ cls: "ct-error", text: t("capture.failed", { error: e instanceof Error ? e.message : String(e) }) });
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
    const nt = noteText(this.plugin.outputLang());
    const truncatedNote = truncated ? `\n\n> [!warning] ${nt.truncated}\n` : "";
    const photosBlock = embeds.length
      ? `\n\n> [!info]- ${nt.photos}\n${embeds.map((p) => `> ![[${p}]]`).join("\n")}\n`
      : "";

    const notePath = repo.lectureNotePath(course, date);
    const existing = this.app.vault.getFileByPath(notePath);
    if (existing) {
      // 同一天多次拍照：追加，不覆盖
      const section = `\n\n## ${format(nt.addendum, { time: formatTime(new Date()) })}\n\n${body}${truncatedNote}${photosBlock}`;
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
    el.createDiv({ cls: "ct-success", text: t("capture.written", { path: file.path }) });
    if (truncated) el.createDiv({ cls: "ct-warning", text: t("capture.truncated") });

    const hasProfessorNotes = this.plugin.repo.professorCandidates(course, date).some((c) => c.suggested);
    if (!hasProfessorNotes) {
      const msg = t("capture.missingProfessor", { date, folder: this.plugin.repo.professorFolder(course) });
      el.createDiv({ cls: "ct-warning", text: msg });
      new Notice(msg, 10000);
    }

    this.photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    this.photos = [];
    this.renderThumbs();

    const actions = el.createDiv("ct-actions");
    actions.createEl("button", { text: t("capture.openNote") }).addEventListener("click", () => {
      void this.app.workspace.getLeaf(false).openFile(file);
      this.close();
    });
    actions.createEl("button", { text: t("capture.startReview"), cls: "mod-cta" }).addEventListener("click", () => {
      this.close();
      void this.plugin.openReview({ course, date });
    });
  }
}
