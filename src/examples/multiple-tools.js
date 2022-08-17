import Aioli from "../../dist/aioli.mjs";

// Initialize Aioli with samtools and seqtk
const CLI = await new Aioli(["samtools/1.10", "seqtk/1.3", {
	tool: "bedtools",
	version: "2.29.2",
	loading: "lazy"
}], { debug: true });
console.log("ls /shared", await CLI.ls("/shared/"))
console.log("ls /shared/data/", await CLI.ls("/shared/data/"))

// Convert SAM to FASTQ
const output = await CLI.exec("samtools fastq -0 toy.fastq -o toy.fastq /shared/samtools/examples/toy.sam");
document.getElementById("output-samtools").innerHTML = output;
console.log("ls /shared/data/", await CLI.ls("/shared/data/"))

// Run seqtk on output of samtools
const output2 = await CLI.exec("seqtk fqchk toy.fastq");
document.getElementById("output-seqtk").innerHTML = output2;
