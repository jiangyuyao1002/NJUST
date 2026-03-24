import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"

import type { Language } from "@njust-ai-cj/types"

import { LANGUAGES } from "@roo/language"

import { cn } from "@src/lib/utils"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"

type FontFamily = "serif" | "sans-serif" | "default"

const FONT_OPTIONS: { value: FontFamily; labelKey: string }[] = [
	{ value: "serif", labelKey: "settings:appearance.fontFamily.serif" },
	{ value: "sans-serif", labelKey: "settings:appearance.fontFamily.sans-serif" },
	{ value: "default", labelKey: "settings:appearance.fontFamily.default" },
]

type AppearanceSettingsProps = HTMLAttributes<HTMLDivElement> & {
	language: string
	fontFamily: string
	setCachedStateField: SetCachedStateField<"language" | "fontFamily">
}

export const AppearanceSettings = ({
	language,
	fontFamily,
	setCachedStateField,
	className,
	...props
}: AppearanceSettingsProps) => {
	const { t } = useAppTranslation()

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>{t("settings:sections.appearance")}</SectionHeader>

			<Section>
				<SearchableSetting
					settingId="language-select"
					section="appearance"
					label={t("settings:appearance.language.label")}>
					<div className="flex flex-col gap-1">
						<label className="text-xs text-vscode-descriptionForeground">
							{t("settings:appearance.language.label")}
						</label>
						<Select
							value={language}
							onValueChange={(value) => setCachedStateField("language", value as Language)}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder={t("settings:common.select")} />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{Object.entries(LANGUAGES).map(([code, name]) => (
										<SelectItem key={code} value={code}>
											{name}
											<span className="text-muted-foreground"> ({code})</span>
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
					</div>
				</SearchableSetting>

				<SearchableSetting
					settingId="font-family-select"
					section="appearance"
					label={t("settings:appearance.fontFamily.label")}>
					<div className="flex flex-col gap-1">
						<label className="text-xs text-vscode-descriptionForeground">
							{t("settings:appearance.fontFamily.label")}
						</label>
						<Select
							value={fontFamily}
							onValueChange={(value) => setCachedStateField("fontFamily", value as FontFamily)}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder={t("settings:common.select")} />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{FONT_OPTIONS.map(({ value, labelKey }) => (
										<SelectItem key={value} value={value}>
											{t(labelKey)}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
						<p className="text-xs text-vscode-descriptionForeground mt-1">
							{t("settings:appearance.fontFamily.description")}
						</p>
					</div>
				</SearchableSetting>
			</Section>
		</div>
	)
}
