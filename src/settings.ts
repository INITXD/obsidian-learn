import { App, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type CourseTutorPlugin from "./main.ts";
import type { Effort } from "./llm/anthropic.ts";
import type { MaxTokensParam } from "./llm/openai.ts";

export interface CourseTutorSettings {
  provider: "anthropic" | "openai";
  /** 旧版 Obsidian（< 1.11.4）没有密钥存储时的明文回退 */
  anthropicApiKey: string;
  /** Obsidian 密钥存储中的条目名 */
  anthropicSecretId: string;
  anthropicModel: string;
  anthropicEffort: Effort | "";
  anthropicFallbacks: boolean;
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiSecretId: string;
  openaiModel: string;
  openaiMaxTokensParam: MaxTokensParam;

  coursesRoot: string;
  lectureNotesFolder: string;
  courseNotePath: string;
  professorNotesFolder: string;
  attachmentsFolder: string;
  saveOriginalPhotos: boolean;

  icsUrl: string;
  courseAliases: string;

  maxImageEdge: number;
  maxPdfPages: number;
  maxMaterialChars: number;
}

export const DEFAULT_SETTINGS: CourseTutorSettings = {
  provider: "anthropic",
  anthropicApiKey: "",
  anthropicSecretId: "",
  anthropicModel: "claude-opus-5-5",
  anthropicEffort: "high",
  anthropicFallbacks: true,
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiApiKey: "",
  openaiSecretId: "",
  openaiModel: "",
  openaiMaxTokensParam: "max_tokens",

  coursesRoot: "Courses",
  lectureNotesFolder: "课堂笔记",
  courseNotePath: "Course Note.md",
  professorNotesFolder: "教授笔记",
  attachmentsFolder: "attachments",
  saveOriginalPhotos: true,

  icsUrl: "",
  courseAliases: "",

  maxImageEdge: 2048,
  maxPdfPages: 40,
  maxMaterialChars: 80000,
};

export class CourseTutorSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: CourseTutorPlugin) {
    super(app, plugin);
  }

  /**
   * Obsidian ≥ 1.11.4 使用系统密钥存储（Key 不写入 data.json，不会随仓库同步）；
   * 更早的版本回退为明文保存在 data.json。
   */
  private apiKeySetting(
    containerEl: HTMLElement,
    secretKey: "anthropicSecretId" | "openaiSecretId",
    plainKey: "anthropicApiKey" | "openaiApiKey",
  ): void {
    const s = this.plugin.settings;
    const setting = new Setting(containerEl).setName("API Key");
    if (hasSecretStorage(this.app)) {
      setting.setDesc(
        s[plainKey]
          ? "检测到旧版明文 Key。选择或新建一个密钥条目后，明文 Key 会从 data.json 中删除。"
          : "选择或新建一个密钥条目。Key 保存在 Obsidian 的密钥存储中，不写入插件的 data.json。",
      );
      setting.addComponent((el) =>
        new SecretComponent(this.app, el).setValue(s[secretKey]).onChange(async (v) => {
          s[secretKey] = v;
          if (v) s[plainKey] = "";
          await this.plugin.saveSettings();
        }),
      );
    } else {
      setting.setDesc("当前 Obsidian 版本没有密钥存储，Key 以明文保存在插件的 data.json 中。");
      setting.addText((t) => {
        t.inputEl.type = "password";
        t.setValue(s[plainKey]).onChange(async (v) => {
          s[plainKey] = v.trim();
          await this.plugin.saveSettings();
        });
      });
    }
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = () => this.plugin.saveSettings();
    containerEl.empty();

    new Setting(containerEl).setName("模型").setHeading();
    new Setting(containerEl)
      .setName("提供方")
      .setDesc("模型需要支持图片输入。")
      .addDropdown((d) =>
        d
          .addOption("anthropic", "Anthropic Claude")
          .addOption("openai", "OpenAI 兼容接口")
          .setValue(s.provider)
          .onChange(async (v) => {
            s.provider = v as CourseTutorSettings["provider"];
            await save();
            this.display();
          }),
      );

    if (s.provider === "anthropic") {
      this.apiKeySetting(containerEl, "anthropicSecretId", "anthropicApiKey");
      new Setting(containerEl).setName("模型 ID").addText((t) =>
        t.setPlaceholder("claude-opus-5-5").setValue(s.anthropicModel).onChange(async (v) => {
          s.anthropicModel = v.trim();
          await save();
        }),
      );
      new Setting(containerEl)
        .setName("Effort")
        .setDesc("思考深度。越高越准确，但更慢、更贵。所选模型不支持 effort 时选“不设置”。")
        .addDropdown((d) => {
          for (const e of ["", "low", "medium", "high", "xhigh", "max"]) d.addOption(e, e || "不设置");
          d.setValue(s.anthropicEffort).onChange(async (v) => {
            s.anthropicEffort = v as Effort | "";
            await save();
          });
        });
      new Setting(containerEl)
        .setName("拒答时自动回退")
        .setDesc("模型安全策略拒答时，由服务端自动改用推荐的其他模型重试（fallbacks: \"default\"）。所选模型不支持而报错时关闭。")
        .addToggle((t) =>
          t.setValue(s.anthropicFallbacks).onChange(async (v) => {
            s.anthropicFallbacks = v;
            await save();
          }),
        );
    } else {
      new Setting(containerEl).setName("Base URL").setDesc("以 /v1 结尾，插件会请求 {Base URL}/chat/completions").addText((t) =>
        t.setValue(s.openaiBaseUrl).onChange(async (v) => {
          s.openaiBaseUrl = v.trim();
          await save();
        }),
      );
      this.apiKeySetting(containerEl, "openaiSecretId", "openaiApiKey");
      new Setting(containerEl).setName("模型 ID").setDesc("必须是支持图片输入的模型").addText((t) =>
        t.setValue(s.openaiModel).onChange(async (v) => {
          s.openaiModel = v.trim();
          await save();
        }),
      );
      new Setting(containerEl)
        .setName("输出长度参数名")
        .setDesc("OpenAI 新模型用 max_completion_tokens；多数兼容接口用 max_tokens。")
        .addDropdown((d) =>
          d
            .addOption("max_tokens", "max_tokens")
            .addOption("max_completion_tokens", "max_completion_tokens")
            .addOption("none", "不传")
            .setValue(s.openaiMaxTokensParam)
            .onChange(async (v) => {
              s.openaiMaxTokensParam = v as MaxTokensParam;
              await save();
            }),
        );
    }

    new Setting(containerEl).setName("仓库结构").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "课程文件夹 = 课程根目录下的每个子文件夹。下面的路径都相对于单个课程文件夹。",
    });
    const pathSetting = (name: string, desc: string, key: keyof CourseTutorSettings) =>
      new Setting(containerEl).setName(name).setDesc(desc).addText((t) =>
        t.setValue(String(s[key])).onChange(async (v) => {
          (s[key] as string) = v.trim().replace(/^\/+|\/+$/g, "");
          await save();
        }),
      );
    pathSetting("课程根目录", "相对仓库根目录；留空表示仓库根目录下的每个文件夹都是课程", "coursesRoot");
    pathSetting("课堂笔记文件夹", "拍照整理生成的 md 存放位置", "lectureNotesFolder");
    pathSetting("Course Note 路径", "可以是单个文件（如 Course Note.md）或文件夹", "courseNotePath");
    pathSetting("教授笔记文件夹", "存放教授讲义的 PDF、图片或 md", "professorNotesFolder");
    pathSetting("照片附件文件夹", "保存压缩后的笔记照片", "attachmentsFolder");
    new Setting(containerEl).setName("保存笔记照片").setDesc("在笔记末尾嵌入照片，方便核对识别结果").addToggle((t) =>
      t.setValue(s.saveOriginalPhotos).onChange(async (v) => {
        s.saveOriginalPhotos = v;
        await save();
      }),
    );

    new Setting(containerEl).setName("课表").setHeading();
    new Setting(containerEl).setName("课表订阅链接").setDesc("ICS / webcal 链接，用于列出当天的课程供选择").addText((t) =>
      t.setValue(s.icsUrl).onChange(async (v) => {
        s.icsUrl = v.trim();
        this.plugin.calendar.invalidate();
        await save();
      }),
    );
    new Setting(containerEl)
      .setName("课程别名")
      .setDesc("课表里的课程名和文件夹名不一致时填写，每行一条：课程文件夹名 = 关键词1, 关键词2")
      .addTextArea((t) => {
        t.inputEl.rows = 5;
        t.setPlaceholder("线性代数 = MATH 221, Linear Algebra").setValue(s.courseAliases).onChange(async (v) => {
          s.courseAliases = v;
          await save();
        });
      });

    new Setting(containerEl).setName("限制").setHeading();
    const numSetting = (name: string, desc: string, key: "maxImageEdge" | "maxPdfPages" | "maxMaterialChars") =>
      new Setting(containerEl).setName(name).setDesc(desc).addText((t) =>
        t.setValue(String(s[key])).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) {
            s[key] = Math.floor(n);
            await save();
          }
        }),
      );
    numSetting("图片最长边（像素）", "照片和 PDF 页面会缩放到此尺寸以内后发送", "maxImageEdge");
    numSetting("每个 PDF 最多页数", "超出部分不会发送，界面会提示", "maxPdfPages");
    numSetting("文字资料总字数上限", "超出时界面会提示，不会静默截断", "maxMaterialChars");
  }
}

export function hasSecretStorage(app: App): boolean {
  return typeof (app as Partial<App>).secretStorage?.getSecret === "function";
}

/** 优先读取密钥存储，没有时回退到明文设置 */
export function resolveApiKey(app: App, secretId: string, plain: string): string {
  if (secretId && hasSecretStorage(app)) return app.secretStorage.getSecret(secretId) ?? "";
  return plain;
}
