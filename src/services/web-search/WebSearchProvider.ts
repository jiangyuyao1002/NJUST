export type WebSearchProviderName = "tavily" | "bing" | "google" | "baidu" | "serpapi" | "duckduckgo" | "baidu-free"

export interface WebSearchResult {
	title: string
	url: string
	snippet: string
}

export interface WebSearchProvider {
	search(query: string, count: number): Promise<WebSearchResult[]>
}

function makeAbortController(timeoutMs = 15_000) {
	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
	return { controller, clear: () => clearTimeout(timeoutId) }
}

export class TavilySearchProvider implements WebSearchProvider {
	constructor(private apiKey: string) {}

	async search(query: string, count: number): Promise<WebSearchResult[]> {
		const truncatedQuery = query.length > 400 ? query.slice(0, 400) : query
		const { controller, clear } = makeAbortController()

		try {
			const response = await fetch("https://api.tavily.com/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					api_key: this.apiKey,
					query: truncatedQuery,
					max_results: Math.min(count, 10),
					search_depth: "advanced",
					include_answer: true,
					include_raw_content: false,
				}),
				signal: controller.signal,
			})

			if (!response.ok) {
				if (response.status === 429) {
					throw new Error("Tavily rate limited. Please wait a moment and try again.")
				}
				throw new Error(`Tavily search failed: ${response.status} ${response.statusText}`)
			}

			const data = (await response.json()) as {
				answer?: string
				results?: Array<{ title?: string; url?: string; content?: string }>
			}

			if (!data.results || !Array.isArray(data.results)) {
				return []
			}

			const results: WebSearchResult[] = data.results.map((r) => ({
				title: r.title || "Untitled",
				url: r.url || "",
				snippet: r.content || "",
			}))

			if (data.answer) {
				results.unshift({ title: "AI-Generated Summary", url: "", snippet: data.answer })
			}

			return results
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				throw new Error("Tavily search timed out after 15 seconds.")
			}
			throw error
		} finally {
			clear()
		}
	}
}

export class BingSearchProvider implements WebSearchProvider {
	constructor(private apiKey: string) {}

	async search(query: string, count: number): Promise<WebSearchResult[]> {
		const { controller, clear } = makeAbortController()

		try {
			const params = new URLSearchParams({
				q: query,
				count: String(Math.min(count, 10)),
				mkt: "zh-CN",
				responseFilter: "Webpages",
			})

			const response = await fetch(`https://api.bing.microsoft.com/v7.0/search?${params}`, {
				headers: { "Ocp-Apim-Subscription-Key": this.apiKey },
				signal: controller.signal,
			})

			if (!response.ok) {
				if (response.status === 401) {
					throw new Error("Bing API key is invalid. Please check your key in Azure Portal.")
				}
				if (response.status === 429) {
					throw new Error("Bing rate limited. Please wait and try again.")
				}
				throw new Error(`Bing search failed: ${response.status} ${response.statusText}`)
			}

			const data = (await response.json()) as {
				webPages?: { value?: Array<{ name?: string; url?: string; snippet?: string }> }
			}

			return (data.webPages?.value ?? []).map((r) => ({
				title: r.name || "Untitled",
				url: r.url || "",
				snippet: r.snippet || "",
			}))
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				throw new Error("Bing search timed out after 15 seconds.")
			}
			throw error
		} finally {
			clear()
		}
	}
}

export class GoogleSearchProvider implements WebSearchProvider {
	private apiKey: string
	private cx: string

	constructor(apiKey: string) {
		const parts = apiKey.split("|")
		this.apiKey = parts[0] ?? ""
		this.cx = parts[1] ?? ""
	}

	async search(query: string, count: number): Promise<WebSearchResult[]> {
		if (!this.cx) {
			throw new Error(
				"Google search requires API Key and Search Engine ID separated by '|'. " +
					"Format: YOUR_API_KEY|YOUR_CX_ID",
			)
		}

		const { controller, clear } = makeAbortController()

		try {
			const params = new URLSearchParams({
				key: this.apiKey,
				cx: this.cx,
				q: query,
				num: String(Math.min(count, 10)),
			})

			const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`, {
				signal: controller.signal,
			})

			if (!response.ok) {
				if (response.status === 403) {
					throw new Error("Google API key is invalid or quota exceeded.")
				}
				throw new Error(`Google search failed: ${response.status} ${response.statusText}`)
			}

			const data = (await response.json()) as {
				items?: Array<{ title?: string; link?: string; snippet?: string }>
			}

			return (data.items ?? []).map((r) => ({
				title: r.title || "Untitled",
				url: r.link || "",
				snippet: r.snippet || "",
			}))
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				throw new Error("Google search timed out after 15 seconds.")
			}
			throw error
		} finally {
			clear()
		}
	}
}

export class BaiduSearchProvider implements WebSearchProvider {
	constructor(private apiKey: string) {}

	async search(query: string, count: number): Promise<WebSearchResult[]> {
		const { controller, clear } = makeAbortController()

		try {
			const params = new URLSearchParams({
				query: query,
				page_num: "1",
				page_size: String(Math.min(count, 10)),
			})

			const response = await fetch(`https://aip.baidubce.com/rest/2.0/search/v1/resource/web?${params}`, {
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				signal: controller.signal,
			})

			if (!response.ok) {
				if (response.status === 401) {
					throw new Error("Baidu API token is invalid or expired.")
				}
				throw new Error(`Baidu search failed: ${response.status} ${response.statusText}`)
			}

			const data = (await response.json()) as {
				results?: Array<{ title?: string; url?: string; content?: string }>
			}

			return (data.results ?? []).map((r) => ({
				title: (r.title || "Untitled").replace(/<[^>]*>/g, ""),
				url: r.url || "",
				snippet: (r.content || "").replace(/<[^>]*>/g, ""),
			}))
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				throw new Error("Baidu search timed out after 15 seconds.")
			}
			throw error
		} finally {
			clear()
		}
	}
}

export class BaiduFreeSearchProvider implements WebSearchProvider {
	async search(query: string, count: number): Promise<WebSearchResult[]> {
		const { controller, clear } = makeAbortController(15_000)

		try {
			const params = new URLSearchParams({ wd: query, rn: String(Math.min(count, 10)) })
			const response = await fetch(`https://www.baidu.com/s?${params}`, {
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
					Accept: "text/html",
					"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
				},
				signal: controller.signal,
			})

			if (!response.ok) {
				throw new Error(`Baidu returned ${response.status}`)
			}

			const html = await response.text()
			return this.parseResults(html, count)
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				throw new Error("Baidu search timed out.")
			}
			throw new Error(`Baidu search failed: ${error instanceof Error ? error.message : String(error)}`)
		} finally {
			clear()
		}
	}

	private parseResults(html: string, maxResults: number): WebSearchResult[] {
		const results: WebSearchResult[] = []

		const h3Regex =
			/<h3[^>]*>[\s\S]*?<a[^>]+href="(https?:\/\/www\.baidu\.com\/link\?[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/gi
		let match: RegExpExecArray | null

		while ((match = h3Regex.exec(html)) !== null && results.length < maxResults) {
			const url = match[1]
			const title = this.stripHtml(match[2]).trim()

			if (!title || title.length < 2) continue

			const afterPos = match.index + match[0].length
			const afterBlock = html.substring(afterPos, afterPos + 4000)
			const snippetMatch =
				afterBlock.match(/class="[^"]*cos-text-body[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|p)>/i) ||
				afterBlock.match(/<p[^>]*>([\s\S]{20,500}?)<\/p>/i) ||
				afterBlock.match(/class="[^"]*(?:content|abstract|desc|paragraph)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|p)>/i) ||
				afterBlock.match(/class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span)>/i)
			const snippet = snippetMatch ? this.stripHtml(snippetMatch[1]).trim().substring(0, 300) : ""

			results.push({ title, url, snippet })
		}

		return results
	}

	private stripHtml(html: string): string {
		return html
			.replace(/<[^>]*>/g, "")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&#x27;/g, "'")
			.replace(/&nbsp;/g, " ")
			.replace(/<!--[\s\S]*?-->/g, "")
			.replace(/\s+/g, " ")
	}
}

export class DuckDuckGoSearchProvider implements WebSearchProvider {
	async search(query: string, count: number): Promise<WebSearchResult[]> {
		const { controller, clear } = makeAbortController(15_000)

		try {
			const response = await fetch("https://lite.duckduckgo.com/lite/", {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					"User-Agent":
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
					Accept: "text/html",
				},
				body: new URLSearchParams({ q: query }).toString(),
				signal: controller.signal,
			})

			if (!response.ok) {
				throw new Error(`DuckDuckGo returned ${response.status}`)
			}

			const html = await response.text()
			const results: WebSearchResult[] = []
			const linkRegex = /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*class="result-link"[^>]*>([\s\S]*?)<\/a>/gi
			const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi
			const links: { url: string; title: string }[] = []
			const snippets: string[] = []

			let m: RegExpExecArray | null
			while ((m = linkRegex.exec(html)) !== null) {
				links.push({ url: m[1], title: m[2].replace(/<[^>]*>/g, "").trim() })
			}
			while ((m = snippetRegex.exec(html)) !== null) {
				snippets.push(m[1].replace(/<[^>]*>/g, "").trim())
			}

			for (let i = 0; i < Math.min(links.length, count); i++) {
				if (links[i].url && links[i].title) {
					results.push({ title: links[i].title, url: links[i].url, snippet: snippets[i] || "" })
				}
			}
			return results
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				throw new Error("DuckDuckGo search timed out.")
			}
			throw new Error(`DuckDuckGo search failed: ${error instanceof Error ? error.message : String(error)}`)
		} finally {
			clear()
		}
	}
}

export type SerpApiEngine = "bing" | "google" | "baidu" | "yandex" | "yahoo" | "duckduckgo"

export class SerpApiSearchProvider implements WebSearchProvider {
	private static readonly MAX_RETRIES = 3
	private static readonly BASE_DELAY_MS = 2000

	constructor(
		private apiKey: string,
		private engine: SerpApiEngine = "bing",
	) {}

	async search(query: string, count: number): Promise<WebSearchResult[]> {
		const { controller, clear } = makeAbortController()

		try {
			const params = new URLSearchParams({
				api_key: this.apiKey,
				q: query,
				num: String(Math.min(count, 10)),
				engine: this.engine,
			})

			let lastError: Error | undefined
			for (let attempt = 0; attempt <= SerpApiSearchProvider.MAX_RETRIES; attempt++) {
				if (attempt > 0) {
					const delay = SerpApiSearchProvider.BASE_DELAY_MS * Math.pow(2, attempt - 1)
					await new Promise((resolve) => setTimeout(resolve, delay))
				}

				const response = await fetch(`https://serpapi.com/search.json?${params}`, {
					signal: controller.signal,
				})

				if (response.status === 429) {
					lastError = new Error(
						`SerpAPI rate limited (attempt ${attempt + 1}/${SerpApiSearchProvider.MAX_RETRIES + 1}). ` +
							(attempt < SerpApiSearchProvider.MAX_RETRIES
								? "Retrying..."
								: "Free plan: 100 searches/month. Upgrade at https://serpapi.com/pricing"),
					)
					continue
				}

				if (!response.ok) {
					if (response.status === 401) {
						throw new Error("SerpAPI key is invalid. Check your key at https://serpapi.com/manage-api-key")
					}
					throw new Error(`SerpAPI search failed: ${response.status} ${response.statusText}`)
				}

				const data = (await response.json()) as {
					answer_box?: { snippet?: string; title?: string; link?: string }
					organic_results?: Array<{ title?: string; link?: string; snippet?: string }>
				}

				const results: WebSearchResult[] = (data.organic_results ?? []).map((r) => ({
					title: r.title || "Untitled",
					url: r.link || "",
					snippet: r.snippet || "",
				}))

				if (data.answer_box?.snippet) {
					results.unshift({
						title: data.answer_box.title || "Answer",
						url: data.answer_box.link || "",
						snippet: data.answer_box.snippet,
					})
				}

				return results
			}

			throw lastError ?? new Error("SerpAPI search failed after retries.")
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				throw new Error("SerpAPI search timed out after 15 seconds.")
			}
			throw error
		} finally {
			clear()
		}
	}
}

export function createSearchProvider(
	providerName: WebSearchProviderName,
	apiKey: string,
	serpApiEngine?: SerpApiEngine,
): WebSearchProvider {
	switch (providerName) {
		case "bing":
			return new BingSearchProvider(apiKey)
		case "google":
			return new GoogleSearchProvider(apiKey)
		case "baidu":
			return new BaiduSearchProvider(apiKey)
		case "serpapi":
			return new SerpApiSearchProvider(apiKey, serpApiEngine ?? "bing")
		case "duckduckgo":
			return new DuckDuckGoSearchProvider()
		case "baidu-free":
			return new BaiduFreeSearchProvider()
		case "tavily":
		default:
			return new TavilySearchProvider(apiKey)
	}
}

export const SEARCH_PROVIDER_INFO: Record<WebSearchProviderName, { label: string; keyHint: string; noKey?: boolean }> = {
	"baidu-free": { label: "Baidu Free (百度免费)", keyHint: "", noKey: true },
	duckduckgo: { label: "DuckDuckGo (Free)", keyHint: "", noKey: true },
	tavily: { label: "Tavily", keyHint: "https://tavily.com" },
	bing: { label: "Bing", keyHint: "Azure Portal → Bing Search API" },
	google: { label: "Google", keyHint: "API_KEY|CX_ID (Google Custom Search)" },
	baidu: { label: "Baidu API", keyHint: "Baidu AI Cloud Access Token" },
	serpapi: { label: "SerpAPI", keyHint: "https://serpapi.com" },
}

export function formatSearchResults(results: WebSearchResult[]): string {
	if (results.length === 0) {
		return "No relevant web search results found."
	}

	const parts: string[] = []

	for (const r of results) {
		if (r.title === "AI-Generated Summary") {
			parts.push(`## Summary\n${r.snippet}`)
		} else {
			parts.push(`### ${r.title}${r.url ? `\nSource: ${r.url}` : ""}\n${r.snippet}`)
		}
	}

	return parts.join("\n\n---\n\n")
}
