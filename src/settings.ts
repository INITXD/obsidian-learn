import { App, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type CourseTutorPlugin from "./main.ts";
import type { Effort } from "./llm/anthropic.ts";
import type { MaxTokensParam } from "./llm/openai.ts";
import { t, tr, type Lang } from "./i18n.ts";

export type UiLanguage = "auto" | Lang;
export type OutputLanguage = "ui" | Lang;

export interface CourseTutorSettings {
  uiLanguage: UiLanguage;
  outputLanguage: OutputLanguage;

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

/** 默认值；文件夹名按首次安装时的界面语言取 */
export function defaultSettings(lang: Lang): CourseTutorSettings {
  return {
    uiLanguage: "auto",
    outputLanguage: "ui",

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
    lectureNotesFolder: tr(lang, "default.lectureFolder"),
    courseNotePath: "Course Note.md",
    professorNotesFolder: tr(lang, "default.professorFolder"),
    attachmentsFolder: "attachments",
    saveOriginalPhotos: true,

    icsUrl: "",
    courseAliases: "",

    maxImageEdge: 2048,
    maxPdfPages: 40,
    maxMaterialChars: 80000,
  };
}

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
          ? t("settings.keyLegacy")
          : t("settings.keySecret"),
      );
      setting.addComponent((el) =>
        new SecretComponent(this.app, el).setValue(s[secretKey]).onChange(async (v) => {
          s[secretKey] = v;
          if (v) s[plainKey] = "";
          await this.plugin.saveSettings();
        }),
      );
    } else {
      setting.setDesc(t("settings.keyPlain"));
      setting.addText((c) => {
        c.inputEl.type = "password";
        c.setValue(s[plainKey]).onChange(async (v) => {
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

    new Setting(containerEl).setName(t("settings.general")).setHeading();
    new Setting(containerEl)
      .setName(t("settings.uiLanguage"))
      .setDesc(t("settings.uiLanguageDesc"))
      .addDropdown((d) =>
        d
          .addOption("auto", t("settings.auto"))
          .addOption("zh", "简体中文")
          .addOption("en", "English")
          .setValue(s.uiLanguage)
          .onChange(async (v) => {
            s.uiLanguage = v as UiLanguage;
            await save();
            this.plugin.applyUiLanguage();
            this.display();
          }),
      );
    new Setting(containerEl)
      .setName(t("settings.outputLanguage"))
      .setDesc(t("settings.outputLanguageDesc"))
      .addDropdown((d) =>
        d
          .addOption("ui", t("settings.followUi"))
          .addOption("zh", "简体中文")
          .addOption("en", "English")
          .setValue(s.outputLanguage)
          .onChange(async (v) => {
            s.outputLanguage = v as OutputLanguage;
            await save();
          }),
      );

    new Setting(containerEl).setName(t("settings.model")).setHeading();
    new Setting(containerEl)
      .setName(t("settings.provider"))
      .setDesc(t("settings.providerDesc"))
      .addDropdown((d) =>
        d
          .addOption("anthropic", "Anthropic Claude")
          .addOption("openai", t("settings.openaiCompatible"))
          .setValue(s.provider)
          .onChange(async (v) => {
            s.provider = v as CourseTutorSettings["provider"];
            await save();
            this.display();
          }),
      );

    if (s.provider === "anthropic") {
      this.apiKeySetting(containerEl, "anthropicSecretId", "anthropicApiKey");
      new Setting(containerEl).setName(t("settings.modelId")).addText((c) =>
        c.setPlaceholder("claude-opus-5-5").setValue(s.anthropicModel).onChange(async (v) => {
          s.anthropicModel = v.trim();
          await save();
        }),
      );
      new Setting(containerEl)
        .setName("Effort")
        .setDesc(t("settings.effortDesc"))
        .addDropdown((d) => {
          for (const e of ["", "low", "medium", "high", "xhigh", "max"]) d.addOption(e, e || t("settings.notSet"));
          d.setValue(s.anthropicEffort).onChange(async (v) => {
            s.anthropicEffort = v as Effort | "";
            await save();
          });
        });
      new Setting(containerEl)
        .setName(t("settings.fallbacks"))
        .setDesc(t("settings.fallbacksDesc"))
        .addToggle((c) =>
          c.setValue(s.anthropicFallbacks).onChange(async (v) => {
            s.anthropicFallbacks = v;
            await save();
          }),
        );
    } else {
      new Setting(containerEl).setName("Base URL").setDesc(t("settings.baseUrlDesc")).addText((c) =>
        c.setValue(s.openaiBaseUrl).onChange(async (v) => {
          s.openaiBaseUrl = v.trim();
          await save();
        }),
      );
      this.apiKeySetting(containerEl, "openaiSecretId", "openaiApiKey");
      new Setting(containerEl).setName(t("settings.modelId")).setDesc(t("settings.modelIdVision")).addText((c) =>
        c.setValue(s.openaiModel).onChange(async (v) => {
          s.openaiModel = v.trim();
          await save();
        }),
      );
      new Setting(containerEl)
        .setName(t("settings.maxTokensParam"))
        .setDesc(t("settings.maxTokensParamDesc"))
        .addDropdown((d) =>
          d
            .addOption("max_tokens", "max_tokens")
            .addOption("max_completion_tokens", "max_completion_tokens")
            .addOption("none", t("settings.omit"))
            .setValue(s.openaiMaxTokensParam)
            .onChange(async (v) => {
              s.openaiMaxTokensParam = v as MaxTokensParam;
              await save();
            }),
        );
    }

    new Setting(containerEl).setName(t("settings.vault")).setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: t("settings.vaultDesc"),
    });
    const pathSetting = (name: string, desc: string, key: keyof CourseTutorSettings) =>
      new Setting(containerEl).setName(name).setDesc(desc).addText((c) =>
        c.setValue(String(s[key])).onChange(async (v) => {
          (s[key] as string) = v.trim().replace(/^\/+|\/+$/g, "");
          await save();
        }),
      );
    pathSetting(t("settings.coursesRoot"), t("settings.coursesRootDesc"), "coursesRoot");
    pathSetting(t("settings.lectureFolder"), t("settings.lectureFolderDesc"), "lectureNotesFolder");
    pathSetting(t("settings.courseNotePath"), t("settings.courseNotePathDesc"), "courseNotePath");
    pathSetting(t("settings.professorFolder"), t("settings.professorFolderDesc"), "professorNotesFolder");
    pathSetting(t("settings.attachmentsFolder"), t("settings.attachmentsFolderDesc"), "attachmentsFolder");
    new Setting(containerEl).setName(t("settings.savePhotos")).setDesc(t("settings.savePhotosDesc")).addToggle((c) =>
      c.setValue(s.saveOriginalPhotos).onChange(async (v) => {
        s.saveOriginalPhotos = v;
        await save();
      }),
    );

    new Setting(containerEl).setName(t("settings.timetable")).setHeading();
    new Setting(containerEl).setName(t("settings.icsUrl")).setDesc(t("settings.icsUrlDesc")).addText((c) =>
      c.setValue(s.icsUrl).onChange(async (v) => {
        s.icsUrl = v.trim();
        this.plugin.calendar.invalidate();
        await save();
      }),
    );
    new Setting(containerEl)
      .setName(t("settings.aliases"))
      .setDesc(t("settings.aliasesDesc"))
      .addTextArea((c) => {
        c.inputEl.rows = 5;
        c.setPlaceholder(t("settings.aliasesPlaceholder")).setValue(s.courseAliases).onChange(async (v) => {
          s.courseAliases = v;
          await save();
        });
      });

    new Setting(containerEl).setName(t("settings.limits")).setHeading();
    const numSetting = (name: string, desc: string, key: "maxImageEdge" | "maxPdfPages" | "maxMaterialChars") =>
      new Setting(containerEl).setName(name).setDesc(desc).addText((c) =>
        c.setValue(String(s[key])).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) {
            s[key] = Math.floor(n);
            await save();
          }
        }),
      );
    numSetting(t("settings.maxImageEdge"), t("settings.maxImageEdgeDesc"), "maxImageEdge");
    numSetting(t("settings.maxPdfPages"), t("settings.maxPdfPagesDesc"), "maxPdfPages");
    numSetting(t("settings.maxChars"), t("settings.maxCharsDesc"), "maxMaterialChars");
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
