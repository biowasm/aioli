import Aioli from "../../dist/aioli.js";

describe("Running WebAssembly modules", () => {
	// Test that we can successfully initialize samtools, run an ls command, and that we can call main()
	it("Run samtools commands", async () => {
		let CLI = await new Aioli([
			{
				tool: "samtools",
				version: "1.10",
				urlPrefix: "http://localhost:11111/tests/data/samtools",
			}
		], {
			urlAioli: "http://localhost:11111/dist/aioli.worker.js",
			urlBaseModule: "http://localhost:11111/tests/data/base",
			debug: true
		});

		// Expect "samtools" preloaded folder to be there, along with "shared", which is where the shared filesystem lives
		const lsObserved = (await CLI.ls("/")).join(",");
		const lsExpected = [".", "..", "tmp", "home", "dev", "proc", "samtools", "shared"].join(",");
		expect(lsObserved).to.equal(lsExpected);

		// Run a simple command
		const versionObserved = await CLI.exec("samtools --version-only");
		const versionExpected = "1.10+htslib-1.10\n";
		expect(versionObserved).to.equal(versionExpected);
	});
});
