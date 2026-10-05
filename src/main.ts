import { Notice, Plugin } from "obsidian";
import { CalendarService } from "./calendar.ts";
import { CourseRepo } from "./courses.ts";
import { AnthropicClient } from "./llm/anthropic.ts";
import { OpenAICompatibleClient } from "./llm/openai.ts";
import type { LLMClient } from "./llm/types.ts";
import { deviceKind } from "./platform.ts";
import { CourseTutorSettingTab, DEFAULT_SETTINGS, resolveApiKey, type CourseTutorSettings } from "./settings.ts";
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
  settings: CourseTutorSettings = { ...DEFAULT_SETTINGS };
  icsCache: IcsCache | undefined;
  repo!: CourseRepo;
  calendar!: CalendarService;

  async onload(): Promise<void> {
    const data = ((await this.loadData()) ?? {}) as Partial<PluginData>;
    this.settings = { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) };
    this.icsCache = data.icsCache;
    this.repo = new CourseRepo(this.app, () => this.settings);
    this.calendar = new CalendarService(this);

    this.registerView(REVIEW_VIEW_TYPE, (leaf) => new ReviewView(leaf, this));
    this.addSettingTab(new CourseTutorSettingTab(this.app, this));

    this.addRibbonIcon("camera", "拍照整理课堂笔记", () => this.openCapture());
    this.addRibbonIcon("search-check", "课程查漏", () => void this.openReview());
    this.addCommand({ id: "capture-notes", name: "拍照整理课堂笔记", callback: () => this.openCapture() });
    this.addCommand({ id: "open-review", name: "对当日课程查漏", callback: () => void this.openReview() });
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
      if (!apiKey) throw new Error("请先在插件设置中设置 Anthropic API Key");
      return new AnthropicClient({
        apiKey,
        model: s.anthropicModel || DEFAULT_SETTINGS.anthropicModel,
        effort: s.anthropicEffort,
        fallbacks: s.anthropicFallbacks,
      });
    }
    const apiKey = resolveApiKey(this.app, s.openaiSecretId, s.openaiApiKey);
    if (!apiKey || !s.openaiModel) throw new Error("请先在插件设置中设置 API Key 和模型 ID");
    return new OpenAICompatibleClient({
      baseUrl: s.openaiBaseUrl,
      apiKey,
      model: s.openaiModel,
      maxTokensParam: s.openaiMaxTokensParam,
    });
  }

  openCapture(): void {
    if (this.repo.listCourses().length === 0) {
      new Notice(`没有找到课程文件夹：请检查设置中的课程根目录（当前：${this.settings.coursesRoot || "仓库根目录"}）`);
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
