import { App, TFile } from "obsidian";
import { IMAGE_EXTS } from "./courses.ts";
import { format, t, type Lang } from "./i18n.ts";
import type { Part } from "./llm/types.ts";
import { imageToJpeg, pdfToImages } from "./media.ts";
import { materialText } from "./prompts.ts";
import type { CourseTutorSettings } from "./settings.ts";

export interface MaterialSection {
  /** 发给模型的分组名（输出语言） */
  label: string;
  /** 给用户看的分组名（界面语言） */
  uiLabel: string;
  files: TFile[];
  /** 没有文件时附加给模型的说明 */
  missingNote: string;
}

export interface LoadedMaterials {
  parts: Part[];
  /** 给用户看的资料清单 */
  summary: string[];
  /** 需要用户注意的情况（例如 PDF 页数超出上限） */
  warnings: string[];
}

export async function loadMaterials(
  app: App,
  settings: CourseTutorSettings,
  outputLang: Lang,
  sections: MaterialSection[],
): Promise<LoadedMaterials> {
  const m = materialText(outputLang);
  const tag = (label: string) => (outputLang === "zh" ? `【${label}】` : `[${label}] `);
  const parts: Part[] = [];
  const summary: string[] = [];
  const warnings: string[] = [];
  let textChars = 0;

  for (const section of sections) {
    const label = section.uiLabel;
    if (section.files.length === 0) {
      parts.push({ type: "text", text: `${tag(section.label)}${section.missingNote}` });
      summary.push(t("mat.none", { label }));
      continue;
    }
    for (const file of section.files) {
      const ext = file.extension.toLowerCase();
      const header = `${tag(section.label)}${file.path}`;
      if (ext === "pdf") {
        const { images, totalPages } = await pdfToImages(
          await app.vault.readBinary(file),
          settings.maxImageEdge,
          settings.maxPdfPages,
        );
        parts.push({ type: "text", text: format(m.pdfHeader, { header, total: totalPages }) });
        images.forEach((img, i) => {
          parts.push({ type: "text", text: format(m.pdfPage, { name: file.name, page: i + 1 }) });
          parts.push(img.part);
        });
        if (totalPages > images.length) {
          warnings.push(t("mat.pdfTruncated", { name: file.name, total: totalPages, count: images.length }));
          parts.push({ type: "text", text: format(m.pdfOmitted, { name: file.name, from: images.length + 1, to: totalPages }) });
        }
        summary.push(t("mat.pdf", { label, name: file.name, count: images.length, total: totalPages }));
      } else if (IMAGE_EXTS.includes(ext)) {
        const blob = Object.assign(new Blob([await app.vault.readBinary(file)]), { name: file.name });
        const img = await imageToJpeg(blob, settings.maxImageEdge);
        parts.push({ type: "text", text: header }, img.part);
        summary.push(t("mat.image", { label, name: file.name }));
      } else {
        const text = await app.vault.cachedRead(file);
        textChars += text.length;
        parts.push({ type: "text", text: `${header}\n\n${text}` });
        summary.push(t("mat.text", { label, name: file.name, chars: text.length }));
      }
    }
  }

  if (textChars > settings.maxMaterialChars) {
    throw new Error(t("error.tooMuchText", { chars: textChars, max: settings.maxMaterialChars }));
  }
  return { parts, summary, warnings };
}
