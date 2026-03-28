import {
	doubaoCodingPlanBaseUrl,
	doubaoDefaultBaseUrl,
	doubaoModels,
	doubaoDefaultModelId,
	doubaoSeedCodeCodingPlanModelId,
	openAiModelInfoSaneDefaults,
	resolveDoubaoInferenceModelId,
	type ModelInfo,
} from "@njust-ai-cj/types"

/** 用户自填 ep- / 控制台 Model ID 时的能力占位（定价以控制台为准） */
const doubaoCustomModelInfo: ModelInfo = {
	...openAiModelInfoSaneDefaults,
	maxTokens: 32_768,
	contextWindow: 262_144,
	supportsImages: true,
	supportsPromptCache: false,
}

import type { ApiHandlerOptions } from "../../shared/api"

import type { ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { OpenAICompatibleHandler, OpenAICompatibleConfig } from "./openai-compatible"

function trimTrailingSlash(url: string): string {
	return url.replace(/\/+$/, "")
}

export class DoubaoHandler extends OpenAICompatibleHandler {
	constructor(options: ApiHandlerOptions) {
		const catalogModelId = options.apiModelId ?? doubaoDefaultModelId
		const modelInfo =
			doubaoModels[catalogModelId as keyof typeof doubaoModels] ?? doubaoCustomModelInfo

		const userBase = (options.doubaoBaseUrl ?? "").trim()
		const effectiveBaseUrl = userBase || doubaoDefaultBaseUrl
		// 仅当用户显式把 Base 设为 Coding Plan 地址时走 ark-code-latest；默认按量 /api/v3 勿自动切套餐，否则会报无订阅
		const usingCodingPlanEndpoint =
			trimTrailingSlash(effectiveBaseUrl) === trimTrailingSlash(doubaoCodingPlanBaseUrl)
		const inferenceModelId =
			catalogModelId === "doubao-seed-code" && usingCodingPlanEndpoint
				? doubaoSeedCodeCodingPlanModelId
				: resolveDoubaoInferenceModelId(catalogModelId)

		const config: OpenAICompatibleConfig = {
			providerName: "doubao",
			baseURL: effectiveBaseUrl,
			apiKey: options.doubaoApiKey ?? "not-provided",
			modelId: inferenceModelId,
			modelInfo,
			modelMaxTokens: options.modelMaxTokens ?? undefined,
			temperature: options.modelTemperature ?? undefined,
		}

		super(options, config)
	}

	override getModel() {
		const id = this.options.apiModelId ?? doubaoDefaultModelId
		const info = doubaoModels[id as keyof typeof doubaoModels] ?? doubaoCustomModelInfo
		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: 0,
		})
		return { id, info, ...params }
	}

	protected override processUsageMetrics(usage: {
		inputTokens?: number
		outputTokens?: number
		details?: {
			cachedInputTokens?: number
			reasoningTokens?: number
		}
		raw?: Record<string, unknown>
	}): ApiStreamUsageChunk {
		return {
			type: "usage",
			inputTokens: usage.inputTokens || 0,
			outputTokens: usage.outputTokens || 0,
			cacheReadTokens: usage.details?.cachedInputTokens,
			reasoningTokens: usage.details?.reasoningTokens,
		}
	}

	protected override getMaxOutputTokens(): number | undefined {
		const modelInfo = this.config.modelInfo
		return this.options.modelMaxTokens || modelInfo.maxTokens || undefined
	}
}
