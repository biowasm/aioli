import Aioli from "../dist/aioli.js";

const TOOLS_LOCAL = [
	{
		tool: "samtools",
		version: "1.10",
		urlPrefix: "http://localhost:11111/tests/data/samtools",
		loading: "lazy"
	},
	{
		tool: "seqtk",
		version: "1.3",
		urlPrefix: "http://localhost:11111/tests/data/seqtk",
	},
	{
		tool: "bedtools",
		version: "2.29.2",
		urlPrefix: "http://localhost:11111/tests/data/bedtools",
		loading: "lazy"
	},
	{
		tool: "coreutils",
		program: "cat",
		version: "8.32",
		urlPrefix: "http://localhost:11111/tests/data/cat",
		loading: "lazy"
	}
];

const TOOLS_CDN = TOOLS_LOCAL.map(d => {
	d.urlPrefix = null;
	return d;
});

describe("Running WebAssembly modules", () => {
	it("Run commands (local)", async () => {
		await runTests(TOOLS_LOCAL);
	});

	it("Run commands (CDN)", async () => {
		await runTests(TOOLS_CDN);
	});
});

async function runTests(TOOLS) {
		const CLI = await new Aioli(TOOLS, { debug: true });

		// Only eager-loaded modules should be initialized now
		await TOOLS.forEach(async (tool, i) => {
			const isLoadedObserved = await CLI.tools[i].ready;
			const isLoadedExpected = tool.loading === "lazy" && i !== 0 ? undefined : true;
			expect(isLoadedObserved).to.equal(isLoadedExpected);
		});

		// Expect "samtools" preloaded folder to be there, along with "shared", which is where the shared filesystem lives
		const lsObserved = (await CLI.ls("/shared")).join(",");
		const lsExpected = [".", "..", "data", "mnt", "samtools"].join(",");
		expect(lsObserved).to.equal(lsExpected);

		// Basic cd / pwd
		await CLI.cd("/shared");
		const pwdObserved = await CLI.pwd();
		const pwdExpected = "/shared";
		expect(pwdObserved).to.equal(pwdExpected);
		await CLI.cd("/shared/data");

		// Test stdin by setting it and calling `cat` without any arguments
		const str = "Hello World";
		CLI.stdin = str;
		expect(await CLI.stdin).to.equal(str);
		const catObserved = await CLI.exec("cat");
		const catExpected = str + "\n";
		expect(catObserved).to.equal(catExpected);

		// Expect bedtools folder to show up after bedtools is initialized
		const bedtoolsObserved = await CLI.exec("bedtools --version");
		const bedtoolsExpected = `bedtools v2.29.2\n`;
		expect(bedtoolsObserved).to.equal(bedtoolsExpected);

		const lsObserved2 = (await CLI.ls("/shared")).join(",");
		const lsExpected2 = lsExpected + ",bedtools";
		expect(lsObserved2).to.equal(lsExpected2);

		// Run a simple command
		const versionObserved = await CLI.exec("samtools --version-only");
		const versionExpected = "1.10+htslib-1.10\n";
		expect(versionObserved).to.equal(versionExpected);

		// samtools: Convert SAM to FASTQ
		const samtoolsFastqObserved = await CLI.exec("samtools fastq -0 toy.fastq -o toy.fastq /shared/samtools/examples/toy.sam");
		const samtoolsFastqExpected = `[M::bam2fq_mainloop] discarded 0 singletons\n[M::bam2fq_mainloop] processed 12 reads\n`;
		expect(samtoolsFastqObserved).to.equal(samtoolsFastqExpected);

		const toyFastqObserved = await CLI.cat("toy.fastq");
		const toyFastqExpected = `@r001\nTTAGATAAAGAGGATACTG\n+\n"""""""""""""""""""\n@r002\nAAAAGATAAGGGATAAA\n+\n"""""""""""""""""\n@r003\nAGCTAA\n+\n""""""\n@r004\nATAGCTCTCAGC\n+\n""""""""""""\n@r003\nGCCTA\n+\n"""""\n@r001\nATGGCGCTG\n+\n"""""""""\n@x1\nAGGTTTTATAAAACAAATAA\n+\n????????????????????\n@x2\nGGTTTTATAAAACAAATAATT\n+\n?????????????????????\n@x3\nTTATAAAACAAATAATTAAGTCTACA\n+\n??????????????????????????\n@x4\nCAAATAATTAAGTCTACAGAGCAAC\n+\n?????????????????????????\n@x5\nAATAATTAAGTCTACAGAGCAACT\n+\n????????????????????????\n@x6\nTAATTAAGTCTACAGAGCAACTA\n+\n???????????????????????\n`;
		expect(toyFastqObserved).to.equal(toyFastqExpected);

		// seqtk: Run fqchk on samtools output
		const seqtkCheckObserved = await CLI.exec("seqtk fqchk toy.fastq");
		const seqtkCheckExpected = `min_len: 5; max_len: 26; avg_len: 17.25; 2 distinct quality values\nPOS\t#bases\t%A\t%C\t%G\t%T\t%N\tavgQ\terrQ\t%low\t%high\nALL\t207\t45.9\t13.5\t15.0\t25.6\t0.0\t20.5\t7.8\t32.9\t67.1\n1\t12\t50.0\t8.3\t16.7\t25.0\t0.0\t15.5\t6.0\t50.0\t50.0\n2\t12\t33.3\t8.3\t25.0\t33.3\t0.0\t15.5\t6.0\t50.0\t50.0\n3\t12\t50.0\t16.7\t16.7\t16.7\t0.0\t15.5\t6.0\t50.0\t50.0\n4\t12\t25.0\t0.0\t25.0\t50.0\t0.0\t15.5\t6.0\t50.0\t50.0\n5\t12\t41.7\t16.7\t8.3\t33.3\t0.0\t15.5\t6.0\t50.0\t50.0\n6\t11\t45.5\t0.0\t9.1\t45.5\t0.0\t16.8\t6.4\t45.5\t54.5\n7\t10\t50.0\t20.0\t0.0\t30.0\t0.0\t18.4\t7.0\t40.0\t60.0\n8\t10\t50.0\t0.0\t10.0\t40.0\t0.0\t18.4\t7.0\t40.0\t60.0\n9\t10\t40.0\t20.0\t10.0\t30.0\t0.0\t18.4\t7.0\t40.0\t60.0\n10\t9\t55.6\t11.1\t33.3\t0.0\t0.0\t20.3\t7.8\t33.3\t66.7\n11\t9\t55.6\t0.0\t22.2\t22.2\t0.0\t20.3\t7.8\t33.3\t66.7\n12\t9\t44.4\t22.2\t33.3\t0.0\t0.0\t20.3\t7.8\t33.3\t66.7\n13\t8\t25.0\t25.0\t12.5\t37.5\t0.0\t22.8\t9.0\t25.0\t75.0\n14\t8\t62.5\t25.0\t0.0\t12.5\t0.0\t22.8\t9.0\t25.0\t75.0\n15\t8\t50.0\t12.5\t12.5\t25.0\t0.0\t22.8\t9.0\t25.0\t75.0\n16\t8\t87.5\t0.0\t0.0\t12.5\t0.0\t22.8\t9.0\t25.0\t75.0\n17\t8\t25.0\t25.0\t25.0\t25.0\t0.0\t22.8\t9.0\t25.0\t75.0\n18\t7\t57.1\t14.3\t0.0\t28.6\t0.0\t25.9\t11.4\t14.3\t85.7\n19\t7\t57.1\t0.0\t42.9\t0.0\t0.0\t25.9\t11.4\t14.3\t85.7\n20\t6\t50.0\t16.7\t16.7\t16.7\t0.0\t30.0\t30.0\t0.0\t100.0\n21\t5\t20.0\t20.0\t20.0\t40.0\t0.0\t30.0\t30.0\t0.0\t100.0\n22\t4\t25.0\t50.0\t0.0\t25.0\t0.0\t30.0\t30.0\t0.0\t100.0\n23\t4\t50.0\t25.0\t0.0\t25.0\t0.0\t30.0\t30.0\t0.0\t100.0\n24\t3\t66.7\t0.0\t0.0\t33.3\t0.0\t30.0\t30.0\t0.0\t100.0\n25\t2\t0.0\t100.0\t0.0\t0.0\t0.0\t30.0\t30.0\t0.0\t100.0\n26\t1\t100.0\t0.0\t0.0\t0.0\t0.0\t30.0\t30.0\t0.0\t100.0\n`;
		expect(seqtkCheckObserved).to.equal(seqtkCheckExpected);

		// seqtk: Run comp on samtools examples folder
		const seqtkCompObserved = await CLI.exec("seqtk comp /shared/samtools/examples/toy.fa");
		const seqtkCompExpected = `ref\t45\t13\t8\t13\t11\t0\t0\t0\t2\t0\t0\t0\nref2\t40\t16\t7\t7\t10\t0\t0\t0\t4\t0\t0\t0\n`;
		expect(seqtkCompObserved).to.equal(seqtkCompExpected);

		// seqtk: Run comp on relative folder path
		await CLI.cd("/shared/samtools");
		const seqtkCompObserved2 = await CLI.exec("seqtk comp examples/toy.fa");
		expect(seqtkCompObserved2).to.equal(seqtkCompExpected);

		// samtools: Run samtools on relative folder path
		const samtoolsViewObserved = await CLI.exec("samtools view examples/toy.sam");
		const samtoolsViewExpected = `r001\t163\tref\t7\t30\t8M4I4M1D3M\t=\t37\t39\tTTAGATAAAGAGGATACTG\t*\tXX:B:S,12561,2,20,112\nr002\t0\tref\t9\t30\t1S2I6M1P1I1P1I4M2I\t*\t0\t0\tAAAAGATAAGGGATAAA\t*\nr003\t0\tref\t9\t30\t5H6M\t*\t0\t0\tAGCTAA\t*\nr004\t0\tref\t16\t30\t6M14N1I5M\t*\t0\t0\tATAGCTCTCAGC\t*\nr003\t16\tref\t29\t30\t6H5M\t*\t0\t0\tTAGGC\t*\nr001\t83\tref\t37\t30\t9M\t=\t7\t-39\tCAGCGCCAT\t*\nx1\t0\tref2\t1\t30\t20M\t*\t0\t0\tAGGTTTTATAAAACAAATAA\t????????????????????\nx2\t0\tref2\t2\t30\t21M\t*\t0\t0\tGGTTTTATAAAACAAATAATT\t?????????????????????\nx3\t0\tref2\t6\t30\t9M4I13M\t*\t0\t0\tTTATAAAACAAATAATTAAGTCTACA\t??????????????????????????\nx4\t0\tref2\t10\t30\t25M\t*\t0\t0\tCAAATAATTAAGTCTACAGAGCAAC\t?????????????????????????\nx5\t0\tref2\t12\t30\t24M\t*\t0\t0\tAATAATTAAGTCTACAGAGCAACT\t????????????????????????\nx6\t0\tref2\t14\t30\t23M\t*\t0\t0\tTAATTAAGTCTACAGAGCAACTA\t???????????????????????\n`;
		expect(samtoolsViewObserved).to.equal(samtoolsViewExpected);
}
