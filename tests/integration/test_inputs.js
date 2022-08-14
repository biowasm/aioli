import Aioli from "../../dist/aioli.js";

describe("Input validation", () => {
	it("Empty constructor", () => {
		try {
			new Aioli();
		} catch (error) {
			expect(error).to.equal("Expecting array of tools as input to Aioli constructor.");
		}
	});

	it("Should provide at least one tool", async () => {
		try {
			new Aioli([]);
		} catch (error) {
			expect(error).to.equal("Expecting at least 1 tool.");
		}
	});
});
