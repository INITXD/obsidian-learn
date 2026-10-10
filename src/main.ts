import * as obsidian from "obsidian";
import { Notice, Plugin } from "obsidian";
import { setUiLang, t, toLang, type Lang } from "./i18n.ts";
import { CalendarService } from "./calendar.ts";
import { CourseRepo } from "./courses.ts";
import { AnthropicClient } from "./llm/anthropic.ts";
import { OpenAICompatibleClient } from "./llm/openai.ts";
import type { LLMClient } from "./llm/types.ts";
import { deviceKind } from "./platform.ts";
import { CourseTutorSettingTab, defaultSettings, resolveApiKey, type CourseTutorSettings } from "./settings.ts";
import { CaptureModal } from "./ui/captureModal.ts";
import type { PickerState } from "./ui/coursePicker.ts";
import { REVIEW_VIEW_TYPE, ReviewView } from "./ui/reviewView.ts";

interface IcsCache {
  url: string;
  text: string;
  fetchedAt: number;
}

interface PluginData {
  settings: CourseTutorSettings;
  icsCache?: IcsCache;
}

export default class CourseTutorPlugin extends Plugin {
  settings: CourseTutorSettings = defaultSettings("en");
  icsCache: IcsCache | undefined;
  repo!: CourseRepo;
  calendar!: CalendarService;

  async onload(): Promise<void> {
    const data = ((await this.loadData()) ?? {}) as Partial<PluginData>;
    const saved: Partial<CourseTutorSettings> = data.settings ?? {};
    this.settings = { ...defaultSettings(this.resolveUiLang(saved.uiLanguage)), ...saved };
    this.applyUiLanguage();
    this.icsCache = data.icsCache;
    this.repo = new CourseRepo(this.app, () => this.settings);
    this.calendar = new CalendarService(this);

    this.registerView(REVIEW_VIEW_TYPE, (leaf) => new ReviewView(leaf, this));
    this.addSettingTab(new CourseTutorSettingTab(this.app, this));

    this.addRibbonIcon("camera", t("cmd.capture"), () => this.openCapture());
    this.addRibbonIcon("search-check", t("view.review"), () => void this.openReview());
    this.addCommand({ id: "capture-notes", name: t("cmd.capture"), callback: () => this.openCapture() });
    this.addCommand({ id: "open-review", name: t("cmd.review"), callback: () => void this.openReview() });
  }

  /** Obsidian 的界面语言。getLanguage() 自 1.8.7 起提供，更早的版本读 localStorage */
  private appLang(): Lang {
    const getLanguage = (obsidian as { getLanguage?: () => string }).getLanguage;
    if (typeof getLanguage === "function") return toLang(getLanguage());
    try {
      return toLang(window.localStorage.getItem("language"));
    } catch {
      return "en";
    }
  }

  private resolveUiLang(setting: CourseTutorSettings["uiLanguage"] | undefined): Lang {
    return !setting || setting === "auto" ? this.appLang() : setting;
  }

  applyUiLanguage(): void {
    setUiLang(this.resolveUiLang(this.settings.uiLanguage));
  }

  /** 生成笔记、查漏对话和报告使用的语言 */
  outputLang(): Lang {
    const o = this.settings.outputLanguage;
    return o === "ui" ? this.resolveUiLang(this.settings.uiLanguage) : o;
  }

  private async persist(): Promise<void> {
    await this.saveData({ settings: this.settings, icsCache: this.icsCache } satisfies PluginData);
  }

  async saveSettings(): Promise<void> {
    await this.persist();
  }

  async saveIcsCache(cache: IcsCache): Promise<void> {
    this.icsCache = cache;
    await this.persist();
  }

  createClient(): LLMClient {
    const s = this.settings;
    if (s.provider === "anthropic") {
      const apiKey = resolveApiKey(this.app, s.anthropicSecretId, s.anthropicApiKey);
      if (!apiKey) throw new Error(t("error.anthropicKey"));
      return new AnthropicClient({
        apiKey,
        model: s.anthropicModel || defaultSettings("en").anthropicModel,
        effort: s.anthropicEffort,
        fallbacks: s.anthropicFallbacks,
      });
    }
    const apiKey = resolveApiKey(this.app, s.openaiSecretId, s.openaiApiKey);
    if (!apiKey || !s.openaiModel) throw new Error(t("error.openaiKey"));
    return new OpenAICompatibleClient({
      baseUrl: s.openaiBaseUrl,
      apiKey,
      model: s.openaiModel,
      maxTokensParam: s.openaiMaxTokensParam,
    });
  }

  openCapture(): void {
    if (this.repo.listCourses().length === 0) {
      new Notice(t("notice.noCourses", { root: this.settings.coursesRoot || t("vaultRoot") }));
    }
    new CaptureModal(this).open();
  }

  async openReview(target?: PickerState): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(REVIEW_VIEW_TYPE)[0];
    if (!leaf) {
      // iPhone 的侧边栏是抽屉，对话不方便，放到主区域；iPad 和 macOS 放右侧边栏，与笔记并排
      leaf = deviceKind() === "phone" ? workspace.getLeaf("tab") : (workspace.getRightLeaf(false) ?? workspace.getLeaf("tab"));
      await leaf.setViewState({ type: REVIEW_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
    if (target && leaf.view instanceof ReviewView) leaf.view.setTarget(target);
  }
}
