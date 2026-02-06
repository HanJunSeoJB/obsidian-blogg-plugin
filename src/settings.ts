import { App, PluginSettingTab, Setting } from "obsidian";
import BlogAssistantPlugin from "./main";

export interface BlogAssistantSettings {
	writingProfile: string;
	apiKey: string;
}

export const DEFAULT_SETTINGS: BlogAssistantSettings = {
	writingProfile: "자연스러운 한국어 블로그 어투",
	apiKey: "",
};

export class BlogAssistantSettingTab extends PluginSettingTab {
	plugin: BlogAssistantPlugin;

	constructor(app: App, plugin: BlogAssistantPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		new Setting(containerEl)
			.setName("기본 글쓰기 어투 프로필")
			.setDesc(
				"텍스트 생성 시 참고하는 기본 어투 힌트입니다. API 키는 vault 루트의 .env 값을 사용합니다.",
			)
			.addText((text) =>
				text
					.setPlaceholder("예: 설명형, 친절한 존댓말, 간결한 기술 블로그 톤")
					.setValue(this.plugin.settings.writingProfile)
					.onChange((value) => {
						this.plugin.settings.writingProfile = value.trim();
						void this.plugin.saveSettings();
					}),
			);
	}
}
