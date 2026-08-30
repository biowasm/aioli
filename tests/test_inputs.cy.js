const TOOLS = [
	{
		tool: "samtools",
		version: "1.10",
		urlPrefix: "http://localhost:11111/tests/data/samtools",
		loading: "lazy"
	}
];

function withAioli(fn) {
	cy.visit("/tests/harness.html");
	cy.window().then(fn);
}

describe("Input validation", () => {
	it("Empty constructor", () => withAioli((win) => {
		try {
			new win.Aioli();
		} catch (error) {
			expect(error).to.equal("Expecting array of tools as input to Aioli constructor.");
		}
	}));

	it("Should provide at least one tool", () => withAioli(async (win) => {
		try {
			new win.Aioli([]);
		} catch (error) {
			expect(error).to.equal("Expecting at least 1 tool.");
		}
	}));
});

describe("Aioli features", () => {
	it("Mount File objects", () => withAioli(async (win) => {
		const CLI = await new win.Aioli(TOOLS);
		const file = new File(["file\ncontents\n"], "file.name");
		const paths = await CLI.mount([ file ]);
		expect(paths).to.deep.equal([ "/shared/data/file.name" ]);

		const contents = await CLI.cat("file.name");
		expect(contents).to.equal("file\ncontents\n");
	}));

	it("Read/write", () => withAioli(async (win) => {
		const CLI = await new win.Aioli(TOOLS);
		const file = new File(["file\ncontents\n"], "file.name");
		const paths = await CLI.mount([ file ]);

		// Read returns a typed array
		const buffer = await CLI.read({ path: "file.name", length: 4 });
		expect(buffer).to.deep.equal(new Uint8Array([102, 105, 108, 101]));

		// Make sure write works
		await CLI.write({ path: "file2.name", buffer });
		const contents = await CLI.cat("file2.name");
		expect(contents).to.equal("file");
	}));
});
