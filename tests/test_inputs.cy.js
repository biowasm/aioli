import Aioli from "../dist/aioli.js";

const TOOLS = [
	{
		tool: "samtools",
		version: "1.10",
		urlPrefix: "http://localhost:11111/tests/data/samtools",
		loading: "lazy"
	}
];


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

	it("Should mount File objects", async () => {
		const CLI = await new Aioli(TOOLS);
		const file = new File(["file\ncontents\n"], "file.name");
		const paths = await CLI.mount([ file ]);
		expect(paths).to.deep.equal([ "/shared/data/file.name" ]);

		const contents = await CLI.cat("file.name");
		expect(contents).to.equal("file\ncontents\n");
	});
});
