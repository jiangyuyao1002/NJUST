import { useTranslation } from "react-i18next"

import { Code2, Wrench, Sparkles, BookOpen } from "lucide-react"

const tips = [
	{
		icon: <Code2 className="size-4 shrink-0 mt-0.5" />,
		titleKey: "rooTips.cangjieToolchain.title",
		descriptionKey: "rooTips.cangjieToolchain.description",
	},
	{
		icon: <Wrench className="size-4 shrink-0 mt-0.5" />,
		titleKey: "rooTips.smartDiagnostics.title",
		descriptionKey: "rooTips.smartDiagnostics.description",
	},
	{
		icon: <Sparkles className="size-4 shrink-0 mt-0.5" />,
		titleKey: "rooTips.syntaxAndSnippets.title",
		descriptionKey: "rooTips.syntaxAndSnippets.description",
	},
	{
		icon: <BookOpen className="size-4 shrink-0 mt-0.5" />,
		titleKey: "rooTips.docsIntegration.title",
		descriptionKey: "rooTips.docsIntegration.description",
	},
]

const RooTips = () => {
	const { t } = useTranslation("chat")

	return (
		<div className="flex flex-col gap-2 mb-4 max-w-[500px] text-vscode-descriptionForeground">
			<p className="my-0 pr-2">{t("about")}</p>
			<div className="gap-4">
				{tips.map((tip) => (
					<div key={tip.titleKey} className="flex items-start gap-2 mt-2 mr-6 leading-relaxed">
						{tip.icon}
						<span>
							{t(tip.titleKey)}: {t(tip.descriptionKey)}
						</span>
					</div>
				))}
			</div>
		</div>
	)
}

export default RooTips
