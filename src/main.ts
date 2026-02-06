import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	TFile,
	TextComponent,
	normalizePath,
	requestUrl,
} from "obsidian";
import {
	DEFAULT_SETTINGS,
	MyPluginSettings,
	SampleSettingTab,
} from "./settings";

// Remember to rename these classes and interfaces!

type MetaAction = {
	actionType: string;
	instruction: string;
	raw: string;
};

type GeminiResponse = {
	candidates?: Array<{
		content?: {
			parts?: Array<{
				text?: string;
				inlineData?: { data?: string; mimeType?: string };
				inline_data?: { data?: string; mime_type?: string };
			}>;
		};
	}>;
};

function parseMetaActions(content: string): MetaAction[] {
	const actions: MetaAction[] = [];
	const matches = content.matchAll(/@\(([^)]+)\)\[([^\]]+)\]/g);

	for (const match of matches) {
		actions.push({
			actionType: (match[1] ?? "").trim(),
			instruction: (match[2] ?? "").trim(),
			raw: match[0] ?? "",
		});
	}

	return actions;
}

function noticeHelloIfMeta(content: string) {
	const actions = parseMetaActions(content);
	if (actions.length > 0) {
		new Notice("인식이요");
	}
}

async function callGeminiGreeting(
	apiKey: string,
	model = "gemini-2.5-flash",
): Promise<string> {
	const res = await requestUrlWithLogging("greeting", {
		url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-goog-api-key": apiKey,
		},
		body: JSON.stringify({
			contents: [
				{
					role: "user",
					parts: [{ text: "한국어로 짧게 인사해줘." }],
				},
			],
		}),
	});

	const data = res.json as GeminiResponse;
	const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
	return text && text.length > 0 ? text : "안녕하세요!";
}

async function callGeminiImageSearch(
	apiKey: string,
	query: string,
	app: App,
	model = "gemini-2.5-flash-image",
): Promise<{ imageUrl: string }> {
	const prompt = [
		"Create an image that matches the description.",
		`Description: ${query}`,
	].join("\n");

	const res = await requestUrlWithLogging("image", {
		url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-goog-api-key": apiKey,
		},
		body: JSON.stringify({
			contents: [{ role: "user", parts: [{ text: prompt }] }],
		}),
	});

	const data = res.json as GeminiResponse;
	const parts = data.candidates?.[0]?.content?.parts ?? [];
	const inline = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
	const base64 =
		inline?.inlineData?.data?.trim() ??
		inline?.inline_data?.data?.trim() ??
		"";
	const mimeType =
		inline?.inlineData?.mimeType?.trim() ??
		inline?.inline_data?.mime_type?.trim() ??
		"image/png";

	if (!base64) {
		const firstPartText = parts[0]?.text?.trim() ?? "";
		console.error("Gemini image response has no inline image payload", {
			firstPartText,
			parts,
		});
		const reason =
			firstPartText.length > 0
				? `No image data returned from Gemini. text=${firstPartText.slice(0, 180)}`
				: "No image data returned from Gemini.";
		throw new Error(reason);
	}

	const imagePath = await saveGeneratedImageToVault(
		app,
		base64,
		mimeType,
		query,
	);
	return { imageUrl: imagePath };
}

async function saveGeneratedImageToVault(
	app: App,
	base64: string,
	mimeType: string,
	query: string,
): Promise<string> {
	const folder = "images";
	const folderPath = normalizePath(folder);
	if (!app.vault.getAbstractFileByPath(folderPath)) {
		try {
			await app.vault.createFolder(folderPath);
		} catch {
			// ignore if already exists
		}
	}

	const ext = mimeTypeToExt(mimeType);
	const slug = sanitizeFileName(query) || "image";
	const fileName = `${slug}-${Date.now()}.${ext}`;
	const filePath = normalizePath(`${folder}/${fileName}`);
	const data = base64ToArrayBuffer(base64);

	await app.vault.createBinary(filePath, data);
	return filePath;
}

function mimeTypeToExt(mimeType: string): string {
	switch (mimeType.toLowerCase()) {
		case "image/jpeg":
			return "jpg";
		case "image/webp":
			return "webp";
		case "image/gif":
			return "gif";
		case "image/svg+xml":
			return "svg";
		case "image/bmp":
			return "bmp";
		case "image/png":
		default:
			return "png";
	}
}

function sanitizeFileName(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 50);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
}

async function greetWithGemini(plugin: MyPlugin) {
	const apiKey = plugin.settings.apiKey?.trim();
	if (!apiKey) {
		new ApiKeyModal(plugin.app, plugin).open();
		return;
	}

	try {
		const greeting = await callGeminiGreeting(apiKey);
		new Notice(greeting);
	} catch (error) {
		console.error(error);
		new Notice("Gemini 호출에 실패했어요.");
	}
}

async function callGeminiForAction(
	apiKey: string,
	action: MetaAction,
	model = "gemini-2.5-flash",
): Promise<string> {
	const prompt = [
		"너는 대학 수준으로 설명하는 튜터다.",
		"규칙:",
		"- 고유명사(영문/한글 포함)는 절대 수정하지 마라.",
		"- 그 외 모든 문장은 한국어로 작성하라.",
		"- 주제에서 벗어나지 마라.",
		"",
		`Action type: ${action.actionType}`,
		`Instruction: ${action.instruction}`,
		"",
		"반드시 지켜야 할 요구사항: (Instruction 안의 괄호 요구사항을 그대로 준수하라)",
		"",
		"출력은 요구사항에만 집중해서 작성하라. 다른 내용(기호, 잡담, unrelated 설명)은 금지.",
	].join("\n");
	const res = await requestUrlWithLogging("action", {
		url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-goog-api-key": apiKey,
		},
		body: JSON.stringify({
			contents: [
				{
					role: "user",
					parts: [{ text: prompt }],
				},
			],
		}),
	});

	const data = res.json as GeminiResponse;
	const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
	return text && text.length > 0 ? text : "";
}

function logGeminiError(
	label: "greeting" | "image" | "action",
	res: {
		status: number;
		headers?: Record<string, string>;
		text?: string;
		json?: unknown;
	},
) {
	const headers = res.headers ?? {};
	const retryAfter =
		headers["retry-after"] ||
		headers["Retry-After"] ||
		headers["Retry-after"] ||
		"";
	const bodyText =
		typeof res.text === "string" && res.text.length > 0
			? res.text
			: JSON.stringify(res.json ?? {}, null, 2);

	console.error(
		`Gemini ${label} error: status=${res.status} retry-after=${retryAfter}`,
		{ headers, body: bodyText },
	);
}

async function requestUrlWithLogging(
	label: "greeting" | "image" | "action",
	options: Parameters<typeof requestUrl>[0],
) {
	try {
		const res = await requestUrl(options);
		if (res.status < 200 || res.status >= 300) {
			logGeminiError(label, {
				status: res.status,
				headers: res.headers,
				text: res.text,
				json: res.json,
			});
			throw new Error(`Gemini API error: ${res.status}`);
		}
		return res;
	} catch (err) {
		const e = err as {
			status?: number;
			message?: string;
			responseText?: string;
			text?: string;
			json?: unknown;
			headers?: Record<string, string>;
		};
		if (typeof e?.status === "number") {
			logGeminiError(label, {
				status: e.status,
				headers: e.headers,
				text: e.responseText ?? e.text,
				json: e.json,
			});
		} else {
			console.error(`Gemini ${label} error:`, err);
		}
		throw err;
	}
}

async function processMetaActionsInNote(
	plugin: MyPlugin,
	file: TFile,
): Promise<void> {
	const apiKey = plugin.settings.apiKey?.trim();
	if (!apiKey) {
		new ApiKeyModal(plugin.app, plugin).open();
		return;
	}

	const original = await plugin.app.vault.read(file);
	const actions = parseMetaActions(original);
	if (actions.length === 0) return;

	let updated = original;
	for (const action of actions) {
		if (action.actionType === "이미지 생성") {
			const { imageUrl } = await callGeminiImageSearch(
				apiKey,
				action.instruction,
				plugin.app,
			);
			const md = `![${action.instruction}](${imageUrl})`;
			updated = updated.replace(action.raw, md);
		} else {
			const result = await callGeminiForAction(apiKey, action);
			updated = updated.replace(action.raw, result);
		}
	}

	if (updated !== original) {
		await plugin.app.vault.modify(file, updated);
	}
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	private isProcessingMeta = false;

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		this.addRibbonIcon("dice", "Sample", (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice("Hello world!");
		});

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText("Status bar text");

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: "open-modal-simple",
			name: "Open modal (simple)",
			callback: () => {
				new SampleModal(this.app).open();
			},
		});
		// Command to input and store API key
		this.addCommand({
			id: "set-api-key",
			name: "Set API key",
			callback: () => {
				new ApiKeyModal(this.app, this).open();
			},
		});
		this.addCommand({
			id: "gemini-greet",
			name: "Gemini greet",
			callback: async () => {
				await greetWithGemini(this);
			},
		});
		// Check current note content for @()[] meta actions
		this.addCommand({
			id: "check-meta-actions",
			name: "Check meta actions in current note",
			checkCallback: (checking: boolean) => {
				const markdownView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!markdownView) return false;

				if (!checking) {
					const content = markdownView.editor.getValue();
					noticeHelloIfMeta(content);
				}

				return true;
			},
		});
		this.addCommand({
			id: "process-meta-actions-current-note",
			name: "Process meta actions in current note",
			checkCallback: (checking: boolean) => {
				const markdownView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!markdownView) return false;

				if (!checking) {
					const file = markdownView.file;
					if (file) {
						void processMetaActionsInNote(this, file);
					}
				}

				return true;
			},
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: "replace-selected",
			name: "Replace selected content",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				editor.replaceSelection("Sample editor command");
			},
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: "open-modal-complex",
			name: "Open modal (complex)",
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
				return false;
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// Auto-processing disabled. Use command to trigger manually.

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, "click", (evt: MouseEvent) => {
			new Notice("Click");
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(
			window.setInterval(() => console.log("setInterval"), 5 * 60 * 1000),
		);
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MyPluginSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		let { contentEl } = this;
		contentEl.setText("Woah!");
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class ApiKeyModal extends Modal {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Enter API key" });

		const input = new TextComponent(contentEl);
		input.setPlaceholder("Paste API key");
		if (this.plugin.settings.apiKey) {
			input.setValue(this.plugin.settings.apiKey);
		}

		const saveButton = contentEl.createEl("button", { text: "Save" });
		saveButton.addEventListener("click", async () => {
			this.plugin.settings.apiKey = input.getValue().trim();
			await this.plugin.saveSettings();
			new Notice("API key saved");
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
