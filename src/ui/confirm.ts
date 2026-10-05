import { App, Modal } from "obsidian";

/** 替代 window.confirm：iOS WebView 中原生对话框不可靠 */
export function confirmModal(app: App, message: string, okText = "继续"): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const modal = new Modal(app);
    modal.contentEl.createEl("p", { text: message });
    const actions = modal.contentEl.createDiv("ct-actions");
    actions.createEl("button", { text: "取消" }).addEventListener("click", () => modal.close());
    actions.createEl("button", { text: okText, cls: "mod-cta" }).addEventListener("click", () => {
      result = true;
      modal.close();
    });
    modal.onClose = () => resolve(result);
    modal.open();
  });
}
