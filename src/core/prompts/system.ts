import * as vscode from "vscode"

import { type ModeConfig, type PromptComponent, type CustomModePrompts, type TodoItem } from "@njust-ai-cj/types"

import { Mode, modes, defaultModeSlug, getModeBySlug, getGroupName, getModeSelection } from "../../shared/modes"
import { DiffStrategy } from "../../shared/tools"
import { isEmpty } from "../../utils/object"

import { McpHub } from "../../services/mcp/McpHub"
import { CodeIndexManager } from "../../services/code-index/manager"
import { SkillsManager } from "../../services/skills/SkillsManager"

import type { SystemPromptSettings } from "./types"
import {
	getRulesSection,
	getSystemInfoSection,
	getObjectiveSection,
	getSharedToolUseSection,
	getToolUseGuidelinesSection,
	getCapabilitiesSection,
	getModesSection,
	addCustomInstructions,
	markdownFormattingSection,
	getSkillsSection,
} from "./sections"
import { getCangjieContextSection } from "./sections/cangjie-context"
import { getMultiFileContextSection } from "./sections/multi-file-context"

// Helper function to get prompt component, filtering out empty objects
export function getPromptComponent(
	customModePrompts: CustomModePrompts | undefined,
	mode: string,
): PromptComponent | undefined {
	const component = customModePrompts?.[mode]
	// Return undefined if component is empty
	if (isEmpty(component)) {
		return undefined
	}
	return component
}

async function generatePrompt(
	context: vscode.ExtensionContext,
	cwd: string,
	supportsComputerUse: boolean,
	mode: Mode,
	mcpHub?: McpHub,
	diffStrategy?: DiffStrategy,
	promptComponent?: PromptComponent,
	customModeConfigs?: ModeConfig[],
	globalCustomInstructions?: string,
	experiments?: Record<string, boolean>,
	language?: string,
	rooIgnoreInstructions?: string,
	settings?: SystemPromptSettings,
	todoList?: TodoItem[],
	modelId?: string,
	skillsManager?: SkillsManager,
): Promise<string> {
	if (!context) {
		throw new Error("Extension context is required for generating system prompt")
	}

	// Get the full mode config to ensure we have the role definition (used for groups, etc.)
	const modeConfig = getModeBySlug(mode, customModeConfigs) || modes.find((m) => m.slug === mode) || modes[0]
	const { roleDefinition, baseInstructions } = getModeSelection(mode, promptComponent, customModeConfigs)

	// Check if MCP functionality should be included
	const hasMcpGroup = modeConfig.groups.some((groupEntry) => getGroupName(groupEntry) === "mcp")
	const hasMcpServers = mcpHub && mcpHub.getServers().length > 0
	const shouldIncludeMcp = hasMcpGroup && hasMcpServers

	const codeIndexManager = CodeIndexManager.getInstance(context, cwd)

	// Tool calling is native-only.
	const effectiveProtocol = "native"

	const [modesSection, skillsSection] = await Promise.all([
		getModesSection(context),
		getSkillsSection(skillsManager, mode as string),
	])

	const cangjieContextSection = getCangjieContextSection(cwd, mode as string)
	const multiFileContextSection = cangjieContextSection ? "" : getMultiFileContextSection(cwd)

	// Tools catalog is not included in the system prompt.
	const toolsCatalog = ""

	const webSearchSection = settings?.enableWebSearch
		? `

====

WEB SEARCH

You have the web_search tool available for retrieving real-time information from the internet. Do NOT say "web search is unavailable" — you CAN search the web.

CRITICAL: NEVER use execute_command with curl, wget, httpie, Invoke-WebRequest, or any HTTP client to fetch web content. Use web_search instead.

EFFICIENCY RULES (IMPORTANT):
- Use AT MOST 1-2 searches per user question. One well-crafted search query is usually enough.
- Combine multiple aspects into a SINGLE search query instead of searching separately for each aspect.
  BAD: search "gold price" then search "gold price today" then search "gold price USD"
  GOOD: search "today gold price USD" (one query covers everything)
- Do NOT repeat or rephrase searches if the first search returned relevant results.
- If the first search gives a clear answer, STOP searching and respond immediately.
- Only do a second search if the first one truly failed to answer the question.

WHEN TO USE:
- When the user asks about recent events, current prices, latest versions, or time-sensitive topics
- When you lack knowledge about a specific project, product, or technology
- When the user explicitly asks you to search or look something up

WHEN NOT TO USE:
- When you already have reliable knowledge to answer the question
- When the question is about general programming concepts, syntax, or well-established patterns
- When previous search results in this conversation already contain the answer

HOW TO USE:
- Craft ONE specific, comprehensive search query that covers the user's full question
- Always synthesize results and cite source URLs
- Prefer web search results over training data when they conflict (search results are more recent)`
		: ""

	const basePrompt = `${roleDefinition}

${markdownFormattingSection()}

${getSharedToolUseSection()}${toolsCatalog}

	${getToolUseGuidelinesSection()}

${getCapabilitiesSection(cwd, shouldIncludeMcp ? mcpHub : undefined)}${webSearchSection}

${modesSection}
${skillsSection ? `\n${skillsSection}` : ""}${cangjieContextSection ? `\n${cangjieContextSection}` : ""}${multiFileContextSection ? `\n${multiFileContextSection}` : ""}
${getRulesSection(cwd, settings)}

${getSystemInfoSection(cwd)}

${getObjectiveSection()}

${await addCustomInstructions(baseInstructions, globalCustomInstructions || "", cwd, mode, {
	language: language ?? "en",
	rooIgnoreInstructions,
	settings,
})}`

	return basePrompt
}

export const SYSTEM_PROMPT = async (
	context: vscode.ExtensionContext,
	cwd: string,
	supportsComputerUse: boolean,
	mcpHub?: McpHub,
	diffStrategy?: DiffStrategy,
	mode: Mode = defaultModeSlug,
	customModePrompts?: CustomModePrompts,
	customModes?: ModeConfig[],
	globalCustomInstructions?: string,
	experiments?: Record<string, boolean>,
	language?: string,
	rooIgnoreInstructions?: string,
	settings?: SystemPromptSettings,
	todoList?: TodoItem[],
	modelId?: string,
	skillsManager?: SkillsManager,
): Promise<string> => {
	if (!context) {
		throw new Error("Extension context is required for generating system prompt")
	}

	// Check if it's a custom mode
	const promptComponent = getPromptComponent(customModePrompts, mode)

	// Get full mode config from custom modes or fall back to built-in modes
	const currentMode = getModeBySlug(mode, customModes) || modes.find((m) => m.slug === mode) || modes[0]

	return generatePrompt(
		context,
		cwd,
		supportsComputerUse,
		currentMode.slug,
		mcpHub,
		diffStrategy,
		promptComponent,
		customModes,
		globalCustomInstructions,
		experiments,
		language,
		rooIgnoreInstructions,
		settings,
		todoList,
		modelId,
		skillsManager,
	)
}
