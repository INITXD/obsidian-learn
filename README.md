# Course Notes Tutor（Obsidian 插件）

1. **拍照整理**：拍下课堂笔记，由支持图片输入的 LLM 转写整理成 Markdown，写入对应课程的文件夹。
2. **资料检查**：检查当天的教授笔记是否已经上传，没有就提醒你。
3. **对话查漏**：把你的笔记、Course Note、教授笔记（PDF 逐页转成图片）一起交给模型，由模型逐题提问，找出“理解漏洞”和“笔记漏记”，最后把报告写回当天的笔记。

桌面端和移动端都能用。在手机上，“拍照”按钮会直接打开相机。

## 仓库结构（默认值，可在设置中修改）

```
Courses/                      ← 课程根目录
  线性代数/                   ← 每个子文件夹是一门课
    课堂笔记/2026-10-05 线性代数.md   ← 插件生成
    Course Note.md            ← Course Note（可以是文件或文件夹）
    教授笔记/Lecture 2026-10-05.pdf  ← 你上传的教授讲义
    attachments/              ← 压缩后的笔记照片
```

判定“当天的教授笔记”的规则：文件名包含当天日期（支持 `2026-10-05`、`20261005`、`10月5日`、`10.5` 等写法），**或者**文件是当天加入仓库的。两条都不满足时会提示你上传，你也可以在查漏面板里手动勾选文件。

## 课表

在设置里填 ICS/webcal 订阅链接。插件会展开每周重复的课程，并处理停课（EXDATE）和调课（RECURRENCE-ID）。当天的事件会列出来供你点选，但**以课程下拉框里选中的为准**。课表里的非课程事件会显示为灰色，不能点选。课表名称和文件夹名称不一致时，在“课程别名”里配置：

```
线性代数 = MATH 221, Linear Algebra
```

## 模型

- **Anthropic Claude**：默认 `claude-opus-5-5`，effort 默认为 `high`。默认开启服务端拒答回退（`fallbacks: "default"`）。查漏对话会对资料启用提示缓存，降低多轮对话的费用。
- **OpenAI 兼容接口**：填写 Base URL、Key 和模型 ID。模型必须支持图片输入。

所有请求都通过 Obsidian 的 `requestUrl` 发出，不受 CORS 限制。API Key 以明文保存在 `.obsidian/plugins/obsidian-learn/data.json` 里。如果你会同步或公开这个仓库，请注意这一点。

## 开发

```bash
npm install
npm run dev     # 监听构建
npm run build   # 类型检查 + 生产构建
npm test        # 纯逻辑单元测试（日期、课程匹配、ICS 展开）
```

安装到仓库：把 `main.js`、`manifest.json`、`styles.css` 复制到 `<vault>/.obsidian/plugins/obsidian-learn/`，然后在“第三方插件”中启用。
