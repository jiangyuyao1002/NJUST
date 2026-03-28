import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import {
	type ProviderSettings,
	doubaoCodingPlanBaseUrl,
	doubaoDefaultBaseUrl,
} from "@njust-ai-cj/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"

type DoubaoProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	simplifySettings?: boolean
}

export const Doubao = ({ apiConfiguration, setApiConfigurationField }: DoubaoProps) => {
	const { t } = useAppTranslation()

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.doubaoApiKey || ""}
				type="password"
				onInput={handleInputChange("doubaoApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">Doubao API Key</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			<VSCodeTextField
				value={apiConfiguration?.doubaoBaseUrl || doubaoDefaultBaseUrl}
				onInput={handleInputChange("doubaoBaseUrl")}
				placeholder={doubaoDefaultBaseUrl}
				className="w-full">
				<label className="block font-medium mb-1">Base URL</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2 space-y-1">
				<p>默认对应方舟「按量在线推理」；已订阅 Coding Plan 时请把 Base 改为 {doubaoCodingPlanBaseUrl}</p>
				<p>
					模型可在下方列表选择，或在「模型 ID（可自填）」输入框直接填写；请求时会将内置选项映射为控制台 Model
					ID，自填内容原样提交。仅当 Base 为 Coding Plan 且选 Doubao-Seed-Code 时使用 ark-code-latest。
				</p>
			</div>
			{!apiConfiguration?.doubaoApiKey && (
				<VSCodeButtonLink
					href="https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey?apikey=%7B%7D"
					appearance="secondary">
					Get Doubao API Key
				</VSCodeButtonLink>
			)}
		</>
	)
}
