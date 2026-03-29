import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

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

import type { ApiHandlerOptions } from "../../shared/api"

import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"
import { convertToR1Format } from "../transform/r1-format"

import { OpenAiHandler } from "./openai"
import type { ApiHandlerCreateMessageMetadata } from "../index"

const doubaoCustomModelInfo: ModelInfo = {
	...openAiModelInfoSaneDefaults,
	maxTokens: 32_768,
	contextWindow: 262_144,
	supportsImages: true,
	supportsPromptCache: false,
}

function trimTrailingSlash(url: string): string {
	return url.replace(/\/+$/, "")
}

type DoubaoChatCompletionParams = OpenAI.Chat.ChatCompletionCreateParamsStreaming & {
	thinking_type?: "enabled" | "disabled" | "auto"
}

export class DoubaoHandler extends OpenAiHandler {
	constructor(options: ApiHandlerOptions) {
		const catalogModelId = options.apiModelId ?? doubaoDefaultModelId
		const userBase = (options.doubaoBaseUrl ?? "").trim()
		const effectiveBaseUrl = userBase || doubaoDefaultBaseUrl
		const usingCodingPlanEndpoint =
			trimTrailingSlash(effectiveBaseUrl) === trimTrailingSlash(doubaoCodingPlanBaseUrl)
		const inferenceModelId =
			catalogModelId === "doubao-seed-code" && usingCodingPlanEndpoint
				? doubaoSeedCodeCodingPlanModelId
				: resolveDoubaoInferenceModelId(catalogModelId)

		super({
			...options,
			openAiApiKey: options.doubaoApiKey ?? "not-provided",
			openAiModelId: inferenceModelId,
			openAiBaseUrl: effectiveBaseUrl,
			openAiStreamingEnabled: true,
			includeMaxTokens: true,
		})
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

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const modelId = this.options.openAiModelId ?? this.options.apiModelId ?? doubaoDefaultModelId
		const { info: modelInfo } = this.getModel()

		const isThinkingModel =
			modelId.includes("thinking") || modelId.includes("seed-1.6") || modelId.includes("seed-2.0")

		const convertedMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages], {
			mergeToolResultText: isThinkingModel,
		})

		const requestOptions: DoubaoChatCompletionParams = {
			model: modelId,
			temperature: this.options.modelTemperature ?? 0,
			messages: convertedMessages,
			stream: true as const,
			stream_options: { include_usage: true },
			...(isThinkingModel && { thinking_type: "enabled" }),
			tools: this.convertToolsForOpenAI(metadata?.tools),
			tool_choice: metadata?.tool_choice,
			parallel_tool_calls: metadata?.parallelToolCalls ?? true,
		}

		this.addMaxTokensIfNeeded(requestOptions, modelInfo)

		let stream
		try {
			stream = await this.client.chat.completions.create(requestOptions)
		} catch (error) {
			const { handleOpenAIError } = await import("./utils/openai-error-handler")
			throw handleOpenAIError(error, "Doubao")
		}

		let lastUsage

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta ?? {}

			if (delta.content) {
				yield { type: "text", text: delta.content }
			}

			if ("reasoning_content" in delta && delta.reasoning_content) {
				yield { type: "reasoning", text: (delta.reasoning_content as string) || "" }
			}

			if (delta.tool_calls) {
				for (const toolCall of delta.tool_calls) {
					yield {
						type: "tool_call_partial",
						index: toolCall.index,
						id: toolCall.id,
						name: toolCall.function?.name,
						arguments: toolCall.function?.arguments,
					}
				}
			}

			if (chunk.usage) {
				lastUsage = chunk.usage
			}
		}

		if (lastUsage) {
			yield this.processUsageMetrics(lastUsage, modelInfo)
		}
	}

	protected override processUsageMetrics(usage: any, _modelInfo?: any): ApiStreamUsageChunk {
		return {
			type: "usage",
			inputTokens: usage?.prompt_tokens || 0,
			outputTokens: usage?.completion_tokens || 0,
			cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens,
		}
	}
}
