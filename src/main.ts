import {
	App,
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
	BlogAssistantSettingTab,
	MyPluginSettings,
} from "./settings";

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

const ENV_FILE_PATH = ".env";
const GEMINI_API_KEY_ENV = "GEMINI_API_KEY";

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

async function callGeminiForAction(
	apiKey: string,
	action: MetaAction,
	toneContext: string,
	writingProfile: string,
	model = "gemini-2.5-flash",
): Promise<string> {
	const toneProfile = inferToneProfile(toneContext);
	const prompt = [
		"너는 대학 수준으로 설명하는 튜터다.",
		"규칙:",
		"- 고유명사(영문/한글 포함)는 절대 수정하지 마라.",
		"- 그 외 모든 문장은 한국어로 작성하라.",
		"- 주제에서 벗어나지 마라.",
		"- 스타일 참조 문맥의 어투를 강하게 따라라.",
		"- 특히 종결어미(예: ~요, ~다)와 문장 호흡(짧음/김)을 최대한 맞춰라.",
		"",
		`스타일 참조 문맥:\n${toneContext || "(없음)"}`,
		`스타일 프로필: ${toneProfile}`,
		`기본 글 어투 프로필: ${writingProfile || "(없음)"}`,
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

function inferToneProfile(toneContext: string): string {
	if (!toneContext) return "참조 문맥 부족";
	const endsWithYo = (toneContext.match(/요[.!?。！？]?/g) ?? []).length;
	const endsFormal = (toneContext.match(/(습니다|니다)[.!?。！？]?/g) ?? [])
		.length;
	const endsPlain = (toneContext.match(/다[.!?。！？]?/g) ?? []).length;

	if (endsWithYo > endsPlain) return "존댓말(~요) 중심";
	if (endsFormal > 0) return "격식 존댓말(~습니다/~니다) 중심";
	if (endsPlain > 0) return "평서체(~다) 중심";
	return "참조 문맥 어투 최대한 모사";
}

function logGeminiError(
	label: "image" | "action",
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
	label: "image" | "action",
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

function extractToneContext(contentBeforeAction: string): string {
	const trimmed = contentBeforeAction.trim();
	if (!trimmed) return "";

	// Keep recent text only and extract the last 2 sentence-like chunks.
	const recent = trimmed.slice(-1500).trim();
	if (!recent) return "";

	const parts = recent
		.split(/(?<=[.!?。！？])\s+|\n+/u)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

	if (parts.length === 0) return "";
	return parts.slice(-2).join(" ");
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
			const markerIndex = updated.indexOf(action.raw);
			const before =
				markerIndex >= 0 ? updated.slice(0, markerIndex) : updated;
			const toneContext = extractToneContext(before);
			const result = await callGeminiForAction(
				apiKey,
				action,
				toneContext,
				plugin.settings.writingProfile,
			);
			updated = updated.replace(action.raw, result);
		}
	}

	if (updated !== original) {
		await plugin.app.vault.modify(file, updated);
	}
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: "set-api-key",
			name: "Set API key",
			callback: () => {
				new ApiKeyModal(this.app, this).open();
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
		this.addSettingTab(new BlogAssistantSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		const raw =
			((await this.loadData()) as Partial<MyPluginSettings>) ?? {};
		// Backward compatibility for old setting key.
		if (!raw.writingProfile && (raw as Partial<{ mySetting: string }>).mySetting) {
			raw.writingProfile = (raw as Partial<{ mySetting: string }>).mySetting;
		}
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
		this.settings.apiKey = await this.loadApiKeyFromEnv();
	}

	async saveSettings() {
		await this.saveData({
			writingProfile: this.settings.writingProfile,
		} as Partial<MyPluginSettings>);
		await this.saveApiKeyToEnv(this.settings.apiKey);
	}

	private async loadApiKeyFromEnv(): Promise<string> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(ENV_FILE_PATH))) return "";

		const content = await adapter.read(ENV_FILE_PATH);
		const value = readEnvValue(content, GEMINI_API_KEY_ENV);
		return value ?? "";
	}

	private async saveApiKeyToEnv(apiKey: string): Promise<void> {
		const adapter = this.app.vault.adapter;
		const current = (await adapter.exists(ENV_FILE_PATH))
			? await adapter.read(ENV_FILE_PATH)
			: "";
		const updated = writeEnvValue(
			current,
			GEMINI_API_KEY_ENV,
			apiKey.trim(),
		);
		await adapter.write(ENV_FILE_PATH, updated);
	}
}

function readEnvValue(envText: string, key: string): string | null {
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`^\\s*${escaped}\\s*=\\s*(.*)\\s*$`, "m");
	const match = envText.match(pattern);
	if (!match || match[1] == null) return null;

	const raw = match[1].trim();
	if (
		(raw.startsWith('"') && raw.endsWith('"')) ||
		(raw.startsWith("'") && raw.endsWith("'"))
	) {
		return raw.slice(1, -1);
	}
	return raw;
}

function writeEnvValue(envText: string, key: string, value: string): string {
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`^\\s*${escaped}\\s*=\\s*.*$`, "m");
	const nextLine = `${key}=${value}`;

	if (!envText || envText.trim().length === 0) {
		return `${nextLine}\n`;
	}

	if (pattern.test(envText)) {
		return envText.replace(pattern, nextLine);
	}

	const needsNewline = envText.endsWith("\n") ? "" : "\n";
	return `${envText}${needsNewline}${nextLine}\n`;
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
