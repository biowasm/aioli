import Aioli from "../dist/aioli";

// Initialize Aioli with samtools and seqtk
const CLI = await new Aioli(["samtools/1.10", "seqtk/1.3"]);

// Show reads from toy.sam
const file = "/samtools/examples/toy.sam";
const output = await CLI.exec(`samtools view -h ${file}`);
document.getElementById("output-samtools").innerHTML = output;

// Show reads from toy.sam with flag "16"
await CLI.fs.writeFile("test.fa", ">chr1\nACGTACGACTAGCAG\n>chr2\nACGATCATACCAGCA");
const output2 = await CLI.exec("seqtk comp test.fa");
document.getElementById("output-seqtk").innerHTML = output2;
