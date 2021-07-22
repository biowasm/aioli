# Aioli

[![npm](https://img.shields.io/npm/v/@biowasm/aioli)](https://www.npmjs.com/package/@biowasm/aioli)

Aioli is a library for running genomics command-line tools in the browser using WebAssembly. The WebAssembly modules are obtained from the [biowasm](https://github.com/biowasm/biowasm) CDN.


## Getting Started

### A simple example

Running the genomics tool `samtools` on a small file:

```html
<script src="https://cdn.biowasm.com/v2/aioli/latest/aioli.js"></script>
<script type="module">
// Note that we use `script type="module"` so we can use top-level await statements
const CLI = await new Aioli("samtools/1.10");
const output = await CLI.exec("samtools view -q 20 /samtools/examples/toy.sam");
console.log(output);
</script>
```

### Load multiple tools

Aioli supports running multiple bioinformatics tools at once:

```html
<script src="https://cdn.biowasm.com/v2/aioli/latest/aioli.js"></script>
<script type="module">
const CLI = await new Aioli(["samtools/1.10", "seqtk/1.2"]);

// Run "samtools view"
let output = await CLI.exec("samtools view -q 20 /samtools/examples/toy.sam");
console.log(output);

// Run "seqtk" to get the help screen
output = await CLI.exec("seqtk");
console.log(output);
</script>
```

### Working with user files

We can update the previous example to run `samtools` on a file provided by the user:

```html
<input id="myfile" type="file" multiple>

<script src="https://cdn.biowasm.com/v2/aioli/latest/aioli.js"></script>
<script type="module">
const CLI = await new Aioli("samtools/1.10");
const output = await CLI.exec("samtools --version-only");
console.log(`Loaded ${output}`);

// Get the SAM file header when user selects a file from their computer
async function runSamtools(event) {
    // First, mount the file(s) to a virtual file system
    const files = event.target.files;
    await CLI.mount(files);

    // Retrieve SAM header on the first file the user selected
    const output = await CLI.exec(`samtools view -H ${files[0].name}`);
    console.log(output);
}

document.getElementById("myfile").addEventListener("change", runSamtools, false);
</script>
```


## Aioli Configuration

### Simple

```javascript
// -------------------------------------
// Format: <module>/<version>
// -------------------------------------

new Aioli("seqtk/1.2");
new Aioli("samtools/1.10");

// -------------------------------------
// Format: <module>/<program>/<version>
// -------------------------------------

// For most bioinformatics tools, <module> == <program>
new Aioli("seqtk/seqtk/1.2");  // seqtk/1.2 == seqtk/seqtk/1.2

// But not always! Some tools have multiple sub-tools
new Aioli("seq-align/smith_waterman/2017.10.18");
new Aioli("seq-align/needleman_wunsch/2017.10.18");
```

### Advanced

By default, Aioli retrieves the `.wasm` modules and the Aioli WebWorker code from the biowasm CDN for convenience, but you can also load files from local sources:

```javascript
new Aioli({
    tool: "seq-align",
    version: "2017.10.18",
    program: "smith_waterman",              // optional (defaults to "tool" name)
    urlPrefix: "./path/to/wasm/files/",     // optional (defaults to biowasm CDN)
}, {
    urlAioli: "./path/to/aioli.worker.js",  // optional (defaults to biowasm CDN)
});
```

## Tools using Aioli

| Tool | URL | Repo |
|-|-|-|
| Ribbon | [genomeribbon.com](https://genomeribbon.com) | [MariaNattestad/Ribbon](https://github.com/MariaNattestad/Ribbon) |
| Alignment Sandbox | [alignment.sandbox.bio](https://alignment.sandbox.bio/) | [RobertAboukhalil/alignment-sandbox](https://github.com/robertaboukhalil/alignment-sandbox) |
| fastq.bio | [fastq.bio](http://www.fastq.bio/) | [RobertAboukhalil/fastq.bio](https://github.com/robertaboukhalil/fastq.bio) |
| bam.bio | [bam.bio](http://www.bam.bio/) | [RobertAboukhalil/bam.bio](https://github.com/robertaboukhalil/bam.bio) |


## Background info

### What is WebAssembly?
[WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly) is a fast, low-level, compiled binary instruction format that runs in all major browsers at near native speeds. One key feature of WebAssembly is code reuse: you can port existing C/C++/Rust/etc tools to WebAssembly so those tools can run in the browser.

### What is a WebWorker?
[WebWorkers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) allow you to run JavaScript in the browser in a background thread, which keeps the browser responsive.

### Compiling into WebAssembly
See the [biowasm](https://github.com/biowasm/biowasm/) project.
