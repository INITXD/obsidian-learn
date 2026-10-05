import { App, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { isSameLocalDay, nameMatchesDate } from "./core/dates.ts";
import type { CourseTutorSettings } from "./settings.ts";

export const TEXT_EXTS = ["md", "txt"];
export const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
export const MATERIAL_EXTS = [...TEXT_EXTS, ...IMAGE_EXTS, "pdf"];

export interface Candidate {
  file: TFile;
  /** 文件名含当天日期，或当天被加入仓库 */
  suggested: boolean;
}

export class CourseRepo {
  constructor(private app: App, private settings: () => CourseTutorSettings) {}

  private join(...parts: string[]): string {
    return normalizePath(parts.filter(Boolean).join("/"));
  }

  courseFolder(course: string): string {
    return this.join(this.settings().coursesRoot, course);
  }

  listCourses(): string[] {
    const s = this.settings();
    const root = s.coursesRoot ? this.app.vault.getFolderByPath(normalizePath(s.coursesRoot)) : this.app.vault.getRoot();
    if (!root) return [];
    return root.children
      .filter((c): c is TFolder => c instanceof TFolder && !c.name.startsWith("."))
      .map((c) => c.name)
      .sort((a, b) => a.localeCompare(b, "zh"));
  }

  lectureFolder(course: string): string {
    return this.join(this.courseFolder(course), this.settings().lectureNotesFolder);
  }

  professorFolder(course: string): string {
    return this.join(this.courseFolder(course), this.settings().professorNotesFolder);
  }

  attachmentFolder(course: string): string {
    return this.join(this.courseFolder(course), this.settings().attachmentsFolder);
  }

  lectureNotePath(course: string, date: string): string {
    return this.join(this.lectureFolder(course), `${date} ${course}.md`);
  }

  /** 当天的课堂笔记（文件名含日期的 md） */
  lectureNotesFor(course: string, date: string): TFile[] {
    return this.filesUnder(this.lectureFolder(course), ["md"]).filter((f) => nameMatchesDate(f.basename, date));
  }

  courseNoteCandidates(course: string, date: string): Candidate[] {
    const path = this.join(this.courseFolder(course), this.settings().courseNotePath);
    const target = this.app.vault.getAbstractFileByPath(path);
    if (target instanceof TFile) return [{ file: target, suggested: true }];
    if (target instanceof TFolder) return this.candidatesIn(path, date);
    return [];
  }

  professorCandidates(course: string, date: string): Candidate[] {
    return this.candidatesIn(this.professorFolder(course), date);
  }

  private candidatesIn(folder: string, date: string): Candidate[] {
    return this.filesUnder(folder, MATERIAL_EXTS)
      .map((file) => ({
        file,
        suggested: nameMatchesDate(file.basename, date) || isSameLocalDay(file.stat.ctime, date),
      }))
      .sort((a, b) => Number(b.suggested) - Number(a.suggested) || b.file.stat.ctime - a.file.stat.ctime);
  }

  private filesUnder(folderPath: string, exts: string[]): TFile[] {
    const folder = this.app.vault.getFolderByPath(folderPath);
    if (!folder) return [];
    const out: TFile[] = [];
    const walk = (f: TAbstractFile) => {
      if (f instanceof TFile && exts.includes(f.extension.toLowerCase())) out.push(f);
      else if (f instanceof TFolder) f.children.forEach(walk);
    };
    walk(folder);
    return out;
  }

  async ensureFolder(path: string): Promise<void> {
    const p = normalizePath(path);
    if (this.app.vault.getAbstractFileByPath(p)) return;
    const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    if (parent) await this.ensureFolder(parent);
    await this.app.vault.createFolder(p);
  }

  /** 生成不冲突的文件路径：name.ext、name 1.ext、name 2.ext… */
  uniquePath(folder: string, name: string, ext: string): string {
    for (let i = 0; ; i++) {
      const p = this.join(folder, `${name}${i ? ` ${i}` : ""}.${ext}`);
      if (!this.app.vault.getAbstractFileByPath(p)) return p;
    }
  }
}
