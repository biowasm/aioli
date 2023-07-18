import Aioli from "../../dist/aioli.mjs";

const CLI = await new Aioli(["tn93/1.0.11"], {
	debug: true, 
	printStream: true, 
	callback: (d) =>{
		document.getElementById("output").innerHTML += "\n<span style='color: red'>timestamp: " + performance.now() + "</span>\n";
		document.getElementById("output").innerHTML += d.stdout;
	}
});

// Calculate pairwise distances of sequences in test.fas
const output = await CLI.exec("tn93 -t 0.05 -o test.dst /shared/tn93/test.fas");
const result = await CLI.cat("test.dst");

// Output results
document.getElementById("result").innerHTML = result;