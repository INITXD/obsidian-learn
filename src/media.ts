import { arrayBufferToBase64, loadPdfJs } from "obsidian";
import type { Part } from "./llm/types.ts";

export interface EncodedImage {
  part: Extract<Part, { type: "image" }>;
  bytes: ArrayBuffer;
}

async function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.85): Promise<EncodedImage> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("图片编码失败"))), "image/jpeg", quality),
  );
  const bytes = await blob.arrayBuffer();
  return { part: { type: "image", mediaType: "image/jpeg", data: arrayBufferToBase64(bytes) }, bytes };
}

/** 把图片缩放到最长边不超过 maxEdge 并转成 JPEG（浏览器会按 EXIF 方向绘制） */
export async function imageToJpeg(blob: Blob, maxEdge: number): Promise<EncodedImage> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new Error("无法解码图片（桌面端不支持 HEIC，请先转换为 JPEG）");
    });
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建画布");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await canvasToJpeg(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface PdfImages {
  images: EncodedImage[];
  totalPages: number;
}

/** 用 Obsidian 内置的 PDF.js 把 PDF 逐页渲染成图片 */
export async function pdfToImages(data: ArrayBuffer, maxEdge: number, maxPages: number): Promise<PdfImages> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const images: EncodedImage[] = [];
  try {
    const n = Math.min(doc.numPages, maxPages);
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = maxEdge / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("无法创建画布");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      images.push(await canvasToJpeg(canvas));
      page.cleanup();
    }
    return { images, totalPages: doc.numPages };
  } finally {
    await doc.destroy();
  }
}
