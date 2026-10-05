import { App, TFile } from "obsidian";
import { IMAGE_EXTS } from "./courses.ts";
import type { Part } from "./llm/types.ts";
import { imageToJpeg, pdfToImages } from "./media.ts";
import type { CourseTutorSettings } from "./settings.ts";

export interface MaterialSection {
  label: string;
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
  sections: MaterialSection[],
): Promise<LoadedMaterials> {
  const parts: Part[] = [];
  const summary: string[] = [];
  const warnings: string[] = [];
  let textChars = 0;

  for (const section of sections) {
    if (section.files.length === 0) {
      parts.push({ type: "text", text: `【${section.label}】${section.missingNote}` });
      summary.push(`${section.label}：无`);
      continue;
    }
    for (const file of section.files) {
      const ext = file.extension.toLowerCase();
      const header = `【${section.label}】${file.path}`;
      if (ext === "pdf") {
        const { images, totalPages } = await pdfToImages(
          await app.vault.readBinary(file),
          settings.maxImageEdge,
          settings.maxPdfPages,
        );
        parts.push({ type: "text", text: `${header}（PDF，共 ${totalPages} 页，以下为逐页图片）` });
        images.forEach((img, i) => {
          parts.push({ type: "text", text: `${file.name} 第 ${i + 1} 页：` });
          parts.push(img.part);
        });
        if (totalPages > images.length) {
          warnings.push(`${file.name} 共 ${totalPages} 页，只发送了前 ${images.length} 页（可在设置中调整上限）`);
          parts.push({ type: "text", text: `（${file.name} 第 ${images.length + 1}–${totalPages} 页未提供）` });
        }
        summary.push(`${section.label}：${file.name}（${images.length}/${totalPages} 页）`);
      } else if (IMAGE_EXTS.includes(ext)) {
        const blob = new Blob([await app.vault.readBinary(file)]);
        const img = await imageToJpeg(blob, settings.maxImageEdge);
        parts.push({ type: "text", text: header }, img.part);
        summary.push(`${section.label}：${file.name}`);
      } else {
        const text = await app.vault.cachedRead(file);
        textChars += text.length;
        parts.push({ type: "text", text: `${header}\n\n${text}` });
        summary.push(`${section.label}：${file.name}（${text.length} 字）`);
      }
    }
  }

  if (textChars > settings.maxMaterialChars) {
    throw new Error(
      `文字资料共 ${textChars} 字，超过上限 ${settings.maxMaterialChars} 字。请取消勾选部分文件，或在设置中提高上限。`,
    );
  }
  return { parts, summary, warnings };
}
