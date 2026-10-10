import { App, FuzzySuggestModal, TFile } from "obsidian";
import { IMAGE_EXTS } from "./courses.ts";
import { imageToJpeg, pdfToImages, type EncodedImage } from "./media.ts";
import { t } from "./i18n.ts";
import { isHeic } from "./platform.ts";
import type { CourseTutorSettings } from "./settings.ts";

export type NamedBlob = Blob & { name: string };

export interface PageImage {
  image: EncodedImage;
  /** 来源说明，例如 “IMG_0012.HEIC” 或 “notes.pdf 第 2 页” */
  label: string;
}

/** 文件选择器接受的类型：照片，以及 GoodNotes/Notability/“文件”App 扫描导出的 PDF */
export const ACCEPT = "image/*,application/pdf";

function isPdf(f: NamedBlob): boolean {
  return f.type === "application/pdf" || /\.pdf$/i.test(f.name);
}

function isImage(f: NamedBlob): boolean {
  return f.type.startsWith("image/") || isHeic(f) || IMAGE_EXTS.some((e) => f.name.toLowerCase().endsWith(`.${e}`));
}

/** 统一处理各种来源的文件：图片压缩为 JPEG，PDF 逐页渲染 */
export async function fileToPages(
  file: NamedBlob,
  settings: CourseTutorSettings,
): Promise<{ pages: PageImage[]; warning?: string }> {
  if (isPdf(file)) {
    const { images, totalPages } = await pdfToImages(await file.arrayBuffer(), settings.maxImageEdge, settings.maxPdfPages);
    return {
      pages: images.map((image, i) => ({ image, label: t("input.pdfPage", { name: file.name, page: i + 1 }) })),
      warning: totalPages > images.length
        ? t("input.pdfTruncated", { name: file.name, total: totalPages, count: images.length })
        : undefined,
    };
  }
  if (isImage(file)) {
    return { pages: [{ image: await imageToJpeg(file, settings.maxImageEdge), label: file.name }] };
  }
  throw new Error(t("error.unsupportedFile", { name: file.name }));
}

export async function vaultFileToBlob(app: App, file: TFile): Promise<NamedBlob> {
  const blob = new Blob([await app.vault.readBinary(file)], {
    type: file.extension.toLowerCase() === "pdf" ? "application/pdf" : "",
  });
  return Object.assign(blob, { name: file.name });
}

/**
 * 从仓库中选择图片或 PDF。用于跨设备流程：
 * iPhone 拍照后经 iCloud/同步进入仓库、iPad 上导出的手写 PDF、iOS 分享菜单存入仓库的文件等。
 */
export class VaultMediaPicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private onPick: (file: TFile) => void) {
    super(app);
    this.setPlaceholder(t("input.vaultPlaceholder"));
  }

  getItems(): TFile[] {
    return this.app.vault
      .getFiles()
      .filter((f) => [...IMAGE_EXTS, "heic", "heif", "pdf"].includes(f.extension.toLowerCase()))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onPick(file);
  }
}
