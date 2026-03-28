import { describe, expect, it } from "vitest"

import { doubaoDefaultModelId, resolveDoubaoInferenceModelId } from "../providers/doubao.js"

describe("resolveDoubaoInferenceModelId", () => {
	it("maps catalog keys to Ark Model ID shape (hyphen + version suffix)", () => {
		expect(resolveDoubaoInferenceModelId("doubao-seed-1.6")).toMatch(/^doubao-seed-1-6-\d{6}$/)
		expect(resolveDoubaoInferenceModelId("doubao-1.5-pro-32k")).toBe("doubao-1-5-pro-32k-250115")
		expect(resolveDoubaoInferenceModelId("doubao-seed-code")).toBe("doubao-seed-code-preview-latest")
	})

	it("passes through Endpoint IDs and custom strings", () => {
		expect(resolveDoubaoInferenceModelId("ep-20250101-abcd")).toBe("ep-20250101-abcd")
		expect(resolveDoubaoInferenceModelId("doubao-custom-from-console-999999")).toBe(
			"doubao-custom-from-console-999999",
		)
	})

	it("default catalog id resolves", () => {
		expect(resolveDoubaoInferenceModelId(doubaoDefaultModelId)).not.toContain(".")
	})
})
