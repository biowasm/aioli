import Aioli from "../../dist/aioli.mjs";

// Initialize Aioli with samtools and seqtk
const CLI = await new Aioli([
	{
		tool: "samtools",
		version: "1.16",
		// URL at which .js/.wasm assets are located
		urlPrefix: "http://localhost:12346/biowasm3/tools/samtools/build"
	},
	{
		tool: "htslib",
		program: "htsfile",
		version: "1.16",
		// URL at which .js/.wasm assets are located
		urlPrefix: "http://localhost:12346/biowasm3/tools/htslib/build"
	}
], { debug: true });

const version = await CLI.exec("samtools --version");
document.getElementById("output-version").innerHTML = version;

// Convert SAM to FASTQ
const output = await CLI.exec("samtools view /shared/samtools/examples/toy.sam");
document.getElementById("output-view").innerHTML = output;
