import { Platform } from "obsidian";

/**
 * 目标平台：macOS（Electron）、iOS、iPadOS。
 * 平台差异集中放在这里，界面和业务代码只按“设备形态”和“能力”判断。
 */
export type DeviceKind = "phone" | "tablet" | "desktop";

export function deviceKind(): DeviceKind {
  if (Platform.isPhone) return "phone";
  if (Platform.isTablet) return "tablet";
  return "desktop";
}

/** 能否通过 <input capture> 直接调起相机（iPhone / iPad） */
export function canCaptureFromCamera(): boolean {
  return Platform.isMobile;
}

/** 能否接收拖放（macOS，以及 iPad 分屏时从“照片”“文件”拖入） */
export function supportsDragAndDrop(): boolean {
  return deviceKind() !== "phone";
}

export function isHeic(file: { name: string; type: string }): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

/**
 * macOS 桌面端的 Chromium 不能解码 HEIC（从 iPhone 隔空投送的照片多为 HEIC），
 * 这里调用系统自带的 sips 转成 JPEG。其他平台返回 null。
 * Node 模块只在调用时 require，避免移动端加载时报错。
 */
export async function convertHeicOnMac(data: ArrayBuffer): Promise<ArrayBuffer | null> {
  if (!Platform.isDesktopApp || !Platform.isMacOS) return null;
  const req = (window as unknown as { require: (m: string) => any }).require;
  const fs = req("fs").promises;
  const os = req("os");
  const path = req("path");
  const { execFile } = req("child_process");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutor-"));
  const input = path.join(dir, "in.heic");
  const output = path.join(dir, "out.jpg");
  try {
    await fs.writeFile(input, Buffer.from(data));
    await new Promise<void>((resolve, reject) =>
      execFile("/usr/bin/sips", ["-s", "format", "jpeg", input, "--out", output], (err: Error | null) =>
        err ? reject(err) : resolve(),
      ),
    );
    const buf: Buffer = await fs.readFile(output);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
