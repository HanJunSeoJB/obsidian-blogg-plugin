import { App, PluginSettingTab, Setting } from "obsidian";
import MyPlugin from "./main";

export interface MyPluginSettings {
	writingProfile: string;
	apiKey: string;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	writingProfile: "자연스러운 한국어 블로그 어투",
	apiKey: "",
};

export class BlogAssistantSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.createEl("h2", { text: "Blog Assistant Settings" });

		new Setting(containerEl)
			.setName("기본 글 어투 프로필")
			.setDesc(
				"텍스트 생성 시 참고하는 기본 어투 힌트입니다. API 키는 vault 루트 .env의 GEMINI_API_KEY를 사용합니다.",
			)
			.addText((text) =>
				text
					.setPlaceholder("예: 설명형, 친절한 존댓말, 간결한 기술 블로그 톤")
					.setValue(this.plugin.settings.writingProfile)
				.onChange(async (value) => {
					this.plugin.settings.writingProfile = value.trim();
					await this.plugin.saveSettings();
				}),
			);
	}
}
