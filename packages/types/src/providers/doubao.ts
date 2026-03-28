import type { ModelInfo } from "../model.js"

// https://www.volcengine.com/docs/82379/1554680
// Pricing: https://www.volcengine.com/docs/82379/1544106
// Updated: March 2026
export type DoubaoModelId = keyof typeof doubaoModels

export const doubaoDefaultModelId: DoubaoModelId = "doubao-seed-1.6"

export const doubaoModels = {
	"doubao-seed-1.6": {
		maxTokens: 32_768,
		contextWindow: 262_144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.11,
		outputPrice: 1.13,
		description:
			"Doubao-Seed-1.6 (2026) is ByteDance's flagship model with dynamic deep thinking mechanism, 256K context, and adaptive resource allocation saving 23% compute cost.",
	},
	"doubao-seed-1.6-thinking": {
		maxTokens: 32_768,
		contextWindow: 262_144,
		supportsImages: false,
		supportsPromptCache: false,
		preserveReasoning: true,
		inputPrice: 0.11,
		outputPrice: 1.13,
		description:
			"Doubao-Seed-1.6-Thinking is optimized for complex cognitive tasks with 92.3% accuracy on GSM8K math benchmarks. Deep chain-of-thought reasoning.",
	},
	"doubao-seed-1.6-vision": {
		maxTokens: 32_768,
		contextWindow: 262_144,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.11,
		outputPrice: 1.13,
		cacheReadsPrice: 0.023,
		description:
			"Doubao-Seed-1.6-Vision supports multimodal understanding of text, image, and video with 256K context window.",
	},
	"doubao-seed-code": {
		maxTokens: 32_768,
		contextWindow: 262_144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.11,
		outputPrice: 1.13,
		description:
			"Doubao-Seed-Code is specialized for agentic programming tasks with 256K context, optimized for code generation, debugging, and refactoring.",
	},
	"doubao-1.5-pro-256k": {
		maxTokens: 16_384,
		contextWindow: 262_144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.08,
		outputPrice: 0.08,
		description:
			"Doubao-1.5-Pro-256K excels at reasoning, code, and multi-turn dialogue. Benchmarks on par with GPT-4o and Claude 3.5 Sonnet. Very low cost.",
	},
	"doubao-1.5-pro-32k": {
		maxTokens: 16_384,
		contextWindow: 32_768,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.06,
		outputPrice: 0.06,
		description: "Doubao-1.5-Pro with 32K context, optimized for cost efficiency on shorter tasks.",
	},
	"doubao-1.5-lite-32k": {
		maxTokens: 16_384,
		contextWindow: 32_768,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.014,
		outputPrice: 0.028,
		description:
			"Doubao-1.5-Lite is a lightweight model comparable to GPT-4o-mini and Claude 3.5 Haiku at ultra-low cost.",
	},
	"doubao-1.5-vision-pro-32k": {
		maxTokens: 16_384,
		contextWindow: 32_768,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.28,
		outputPrice: 0.28,
		description:
			"Doubao-1.5-Vision-Pro supports arbitrary resolution image input with leading multimodal understanding performance.",
	},
} as const satisfies Record<string, ModelInfo>

export const DOUBAO_DEFAULT_TEMPERATURE = 0.3

/** 火山方舟 OpenAI 兼容 — 常规在线推理（按 Token）。文档：常规在线推理 / 兼容 OpenAI SDK */
export const doubaoDefaultBaseUrl = "https://ark.cn-beijing.volces.com/api/v3"

/** Coding Plan（套餐）及部分 AI 编程工具对接，与 {@link doubaoDefaultBaseUrl} 不可混用 */
export const doubaoCodingPlanBaseUrl = "https://ark.cn-beijing.volces.com/api/coding/v3"

/** 与 {@link doubaoCodingPlanBaseUrl} 联用时，Doubao-Seed-Code 在 OpenAI 兼容接口中的推荐模型名 */
export const doubaoSeedCodeCodingPlanModelId = "ark-code-latest"

/**
 * 方舟「在线推理」OpenAI 兼容接口里 `model` 须填控制台模型列表中的 **Model ID**（带日期后缀），
 * 或推理接入点的 **Endpoint ID**（`ep-` 开头）。本表把设置里友好的 catalog key 映射为常见 Model ID；
 * 版本号会随官方更新而变化，若报错请对照控制台并可直接在模型下拉中改选或手写 Endpoint ID。
 *
 * @see https://www.volcengine.com/docs/82379/2121998
 * @see https://www.volcengine.com/docs/82379/1330626
 */
export const doubaoInferenceModelIds: Record<DoubaoModelId, string> = {
	"doubao-seed-1.6": "doubao-seed-1-6-251015",
	"doubao-seed-1.6-thinking": "doubao-seed-1-6-thinking-251015",
	"doubao-seed-1.6-vision": "doubao-seed-1-6-vision-251015",
	// 按量 /api/v3；若 Base 设为 Coding Plan（…/api/coding/v3）则由插件对 Seed-Code 改用 ark-code-latest
	"doubao-seed-code": "doubao-seed-code-preview-latest",
	"doubao-1.5-pro-256k": "doubao-1-5-pro-256k-250115",
	"doubao-1.5-pro-32k": "doubao-1-5-pro-32k-250115",
	"doubao-1.5-lite-32k": "doubao-1-5-lite-32k-250115",
	"doubao-1.5-vision-pro-32k": "doubao-1-5-vision-pro-32k-250115",
}

/** 解析发往方舟 API 的 `model` 字段；未知 id（如 `ep-xxx`）原样返回 */
export function resolveDoubaoInferenceModelId(requestedModelId: string): string {
	if (requestedModelId in doubaoInferenceModelIds) {
		return doubaoInferenceModelIds[requestedModelId as DoubaoModelId]
	}
	return requestedModelId
}
