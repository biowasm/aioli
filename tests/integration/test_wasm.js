import Aioli from "../../dist/aioli.js";

describe("Running WebAssembly modules", () => {
	// Test that we can successfully initialize samtools, run an ls command, and that we can call main()
	it("Run samtools commands", async () => {
		let aioli = new Aioli([
			{
				tool: "samtools",
				version: "1.10",
				urlPrefix: "../tests/data/samtools",
			}
		], {
			urlAioli: "../../../dist/aioli.worker.js",
			urlBaseModule: "../tests/data/base",
			debug: true
		});
		await aioli.init();

		// Expect "samtools" preloaded folder to be there, along with "shared", which is where the shared filesystem lives
		const lsObserved = (await aioli.ls("/")).join(",");
		const lsExpected = [".", "..", "tmp", "home", "dev", "proc", "samtools", "shared"].join(",");
		expect(lsObserved).to.equal(lsExpected);

		// Run a simple command
		const versionObserved = (await aioli.exec("samtools --version-only")).stdout;
		const versionExpected = "1.10+htslib-1.10\n";
		expect(versionObserved).to.equal(versionExpected);
	});
});
