const getIconUrl = () => {
	const base = (window as unknown as { IMAGES_BASE_URI?: string }).IMAGES_BASE_URI || ""
	return `${base}/icon.png`
}

const RooHero = () => {
	return (
		<div className="mb-2 pt-4 flex items-center gap-3">
			<img src={getIconUrl()} alt="NJUST_AI_CJ" className="w-10 h-10" />
			<span className="text-2xl font-bold tracking-tight text-vscode-foreground">NJUST_AI_CJ</span>
		</div>
	)
}

export default RooHero
