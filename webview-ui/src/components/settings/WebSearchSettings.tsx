import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox, VSCodeTextField, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"

const PROVIDERS = [
	{ value: "baidu-free", label: "Baidu Free / 百度免费 (推荐)", noKey: true },
	{ value: "duckduckgo", label: "DuckDuckGo (Free, 需翻墙)", noKey: true },
	{ value: "tavily", label: "Tavily" },
	{ value: "bing", label: "Bing (Microsoft)" },
	{ value: "google", label: "Google (Custom Search)" },
	{ value: "baidu", label: "Baidu API / 百度API" },
	{ value: "serpapi", label: "SerpAPI" },
] as const

const SERPAPI_ENGINES = [
	{ value: "bing", label: "Bing" },
	{ value: "google", label: "Google" },
	{ value: "baidu", label: "Baidu (百度)" },
	{ value: "yandex", label: "Yandex" },
	{ value: "yahoo", label: "Yahoo" },
	{ value: "duckduckgo", label: "DuckDuckGo" },
] as const

const NO_KEY_PROVIDERS = new Set(["baidu-free", "duckduckgo"])

type WebSearchSettingsProps = HTMLAttributes<HTMLDivElement> & {
	enableWebSearch?: boolean
	webSearchProvider?: string
	serpApiEngine?: string
	webSearchApiKey?: string
	setCachedStateField: SetCachedStateField<"enableWebSearch" | "webSearchProvider" | "serpApiEngine" | "webSearchApiKey">
}

export const WebSearchSettings = ({
	enableWebSearch,
	webSearchProvider,
	serpApiEngine,
	webSearchApiKey,
	setCachedStateField,
	...props
}: WebSearchSettingsProps) => {
	const { t } = useAppTranslation()
	const currentProvider = webSearchProvider || "baidu-free"
	const currentSerpEngine = serpApiEngine || "bing"
	const needsApiKey = !NO_KEY_PROVIDERS.has(currentProvider)

	return (
		<div {...props}>
			<SectionHeader>{t("settings:sections.webSearch")}</SectionHeader>

			<Section>
				<SearchableSetting
					settingId="web-search-enable"
					section="webSearch"
					label={t("settings:webSearch.enable.label")}>
					<VSCodeCheckbox
						checked={enableWebSearch}
						onChange={(e: any) => {
							setCachedStateField("enableWebSearch", e.target.checked)
						}}>
						<span className="font-medium">{t("settings:webSearch.enable.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:webSearch.enable.description")}
					</div>
				</SearchableSetting>

				{enableWebSearch && (
					<>
						<SearchableSetting
							settingId="web-search-provider"
							section="webSearch"
							label={t("settings:webSearch.provider.label")}
							className="mt-4">
							<label className="block font-medium mb-1">{t("settings:webSearch.provider.label")}</label>
							<VSCodeDropdown
								value={currentProvider}
								onChange={(e: any) => {
									setCachedStateField("webSearchProvider", e.target.value)
									setCachedStateField("webSearchApiKey", "")
								}}>
								{PROVIDERS.map((p) => (
									<VSCodeOption key={p.value} value={p.value}>
										{p.label}
									</VSCodeOption>
								))}
							</VSCodeDropdown>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:webSearch.provider.description")}
							</div>
						</SearchableSetting>

						{currentProvider === "serpapi" && (
							<SearchableSetting
								settingId="web-search-serpapi-engine"
								section="webSearch"
								label={t("settings:webSearch.serpApiEngine.label")}
								className="mt-4">
								<label className="block font-medium mb-1">
									{t("settings:webSearch.serpApiEngine.label")}
								</label>
								<VSCodeDropdown
									value={currentSerpEngine}
									onChange={(e: any) => {
										setCachedStateField("serpApiEngine", e.target.value)
									}}>
									{SERPAPI_ENGINES.map((e) => (
										<VSCodeOption key={e.value} value={e.value}>
											{e.label}
										</VSCodeOption>
									))}
								</VSCodeDropdown>
								<div className="text-vscode-descriptionForeground text-sm mt-1">
									{t("settings:webSearch.serpApiEngine.description")}
								</div>
							</SearchableSetting>
						)}

						{needsApiKey && (
							<SearchableSetting
								settingId="web-search-api-key"
								section="webSearch"
								label={t("settings:webSearch.apiKey.label")}
								className="mt-4">
								<VSCodeTextField
									value={webSearchApiKey || ""}
									type="password"
									onInput={(e: any) => {
										setCachedStateField("webSearchApiKey", e.target.value)
									}}
									placeholder={t(`settings:webSearch.apiKeyHint.${currentProvider}`)}
									className="w-full">
									<label className="block font-medium mb-1">
										{t("settings:webSearch.apiKey.label")}
									</label>
								</VSCodeTextField>
								<div className="text-vscode-descriptionForeground text-sm mt-1">
									{t(`settings:webSearch.apiKeyHint.${currentProvider}`)}
								</div>
							</SearchableSetting>
						)}

						{!needsApiKey && (
							<div className="mt-4 text-vscode-descriptionForeground text-sm">
								{t("settings:webSearch.noKeyRequired")}
							</div>
						)}
					</>
				)}
			</Section>
		</div>
	)
}
