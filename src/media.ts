import { arrayBufferToBase64, loadPdfJs } from "obsidian";
import type { Part } from "./llm/types.ts";
import { convertHeicOnMac, isHeic } from "./platform.ts";

export interface EncodedImage {
  part: Extract<Part, { type: "image" }>;
  bytes: ArrayBuffer;
}

/** 编码后立即释放画布：iOS WebView 的画布总内存很小，PDF 页数多时不释放会崩溃 */
async function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.85): Promise<EncodedImage> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("图片编码失败"))), "image/jpeg", quality),
  );
  canvas.width = canvas.height = 0;
  const bytes = await blob.arrayBuffer();
  return { part: { type: "image", mediaType: "image/jpeg", data: arrayBufferToBase64(bytes) }, bytes };
}

async function decodeImage(blob: Blob): Promise<{ img: HTMLImageElement; url: string } | null> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
    return { img, url };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

/**
 * 把图片缩放到最长边不超过 maxEdge 并转成 JPEG（浏览器会按 EXIF 方向绘制）。
 * iOS/iPadOS 的 WebView 能直接解码 HEIC；macOS 解码失败时用 sips 转换。
 */
export async function imageToJpeg(file: Blob & { name?: string }, maxEdge: number): Promise<EncodedImage> {
  let decoded = await decodeImage(file);
  if (!decoded && isHeic({ name: file.name ?? "", type: file.type })) {
    const jpeg = await convertHeicOnMac(await file.arrayBuffer());
    if (jpeg) decoded = await decodeImage(new Blob([jpeg], { type: "image/jpeg" }));
  }
  if (!decoded) throw new Error("无法解码图片（格式不受支持）");
  const { img, url } = decoded;
  try {
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
