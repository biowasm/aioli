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
			new Aioli([], {
				urlAioli: "http://localhost:11111/dist/aioli.worker.js"
			});
		} catch (error) {
			expect(error).to.equal("Expecting at least 1 tool.");
		}
	});
});
