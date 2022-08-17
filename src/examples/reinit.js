import Aioli from "../../dist/aioli.mjs";

// Initialize Aioli
const CLI = await new Aioli([
	"base/1.0.0",
	{
		tool: "sed",
		version: "4.8",
		reinit: true
	},
], { debug: true });

// Create mock data
await CLI.mount([{
	name: "test.fastq", 
	data: "@read1\nACGTACGACTAGCAG\n+\nJJJJJJJJJJJJJJJ\n@read2\nACGATCATACCAGCA\n+\nJJJJJJJJJJJJJJJ\n"
}]);

// Basic search replace
const output1 = await CLI.exec("sed s/GACT/----/ test.fastq");
document.getElementById("output-1").innerHTML = output1;

// Convert SAM to FASTQ
const output2 = await CLI.exec("sed -n 1~4s/^@/>/p;2~4p test.fastq");
document.getElementById("output-2").innerHTML = output2;
