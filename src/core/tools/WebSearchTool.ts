import { BaseTool, type ToolCallbacks } from "./BaseTool"
import type { Task } from "../task/Task"
import { createSearchProvider, formatSearchResults, SEARCH_PROVIDER_INFO } from "../../services/web-search/WebSearchProvider"
import type { WebSearchProviderName, SerpApiEngine } from "../../services/web-search/WebSearchProvider"

class WebSearchToolImpl extends BaseTool<"web_search"> {
	readonly name = "web_search" as const

	async execute(
		params: { search_query: string; count?: number | null },
		task: Task,
		{ askApproval, handleError, pushToolResult }: ToolCallbacks,
	): Promise<void> {
		try {
			const query = params.search_query
			const count = params.count ?? 5

			if (!query || query.trim().length === 0) {
				pushToolResult("Error: search_query is required and cannot be empty.")
				return
			}

			const provider = task.providerRef.deref()
			const state = await provider?.getState()
			const apiKey = state?.webSearchApiKey
			const providerName = (state?.webSearchProvider ?? "baidu-free") as WebSearchProviderName

			const providerInfo = SEARCH_PROVIDER_INFO[providerName]
			if (!providerInfo.noKey && (!apiKey || apiKey.trim().length === 0)) {
				pushToolResult(
					`Web search API key is not configured. ` +
						`Current search engine: ${providerInfo.label}. ` +
						`Please tell the user: To use web search, configure an API key in Settings > Web Search. ` +
						`Key source: ${providerInfo.keyHint}`,
				)
				return
			}

			const approved = await askApproval("tool", JSON.stringify({ tool: "web_search", engine: providerName, query, count }))
			if (!approved) {
				pushToolResult("Web search was not approved by the user.")
				return
			}

			const serpApiEngine = (state?.serpApiEngine ?? "bing") as SerpApiEngine
			const searchProvider = createSearchProvider(providerName, apiKey ?? "", serpApiEngine)
			const results = await searchProvider.search(query, count)
			const formatted = formatSearchResults(results)

			pushToolResult(formatted)
		} catch (error) {
			await handleError("web search", error instanceof Error ? error : new Error(String(error)))
		} finally {
			this.resetPartialState()
		}
	}
}

export const webSearchTool = new WebSearchToolImpl()
