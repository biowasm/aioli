# Aioli

[![npm](https://img.shields.io/npm/v/@biowasm/aioli)](https://www.npmjs.com/package/@biowasm/aioli)

Aioli is a library for running genomics command-line tools in the browser using WebAssembly.

The WebAssembly modules are hosted on the [biowasm](https://github.com/biowasm/biowasm) CDN.


## Getting Started

Check out [biowasm.com](https://biowasm.com/) for a REPL environment.

### A simple example

Running `samtools` in the browser:

```html
<script src="https://cdn.biowasm.com/v3/aioli/latest/aioli.js"></script>
<script type="module">
// Initialize Aioli with samtools v1.10
const CLI = await new Aioli("samtools/1.10");

// Show reads from toy.sam with flag "16". Try replacing "-f 16" with "-f 0".
const output = await CLI.exec("samtools view -f 16 /samtools/examples/toy.sam");
console.log(output);
</script>
```

Note: you can simply copy-paste the code above into a text editor, save it as a `.html` file and load it in your browser with no setup!

### Load multiple tools

Aioli supports running multiple tools at once:

```html
<script src="https://cdn.biowasm.com/v3/aioli/latest/aioli.js"></script>
<script type="module">
// Note: `script type="module"` lets us use top-level await statements
const CLI = await new Aioli(["samtools/1.10", "seqtk/1.2"]);

// Here we write to a file with one tool, and use it as input for another tool!
// Convert a ".sam" file to a ".fastq", and save the result to "./toy.fastq"
let output = await CLI.exec("samtools fastq -o toy.fastq /samtools/examples/toy.sam");

// Run the tool "seqtk" on "toy.fastq" to generate QC metrics
output = await CLI.exec("seqtk fqchk toy.fastq");
console.log(output);
</script>
```

### Working with user-provided files

Here we ask the user to provide a local file and we run `samtools` on it:

```html
<input id="myfile" type="file" multiple>

<script src="https://cdn.biowasm.com/v3/aioli/latest/aioli.js"></script>
<script type="module">
const CLI = await new Aioli("samtools/1.10");
const output = await CLI.exec("samtools --version-only");
console.log(`Loaded ${output}`);

// Get the SAM file header when user selects a file from their computer
async function runSamtools(event) {
    // First, mount the file(s) to a virtual file system
    const files = event.target.files;
    // The function `.mount()` returns the absolute paths of each file mounted
    const paths = await CLI.mount(files);

    // List files in the current folder
    console.log("ls:", await CLI.ls("."));
    // Get info about the file we mounted (e.g. size, timestamp)
    console.log(`ls ${files[0].name}:`, await CLI.ls(paths[0]));

    // Retrieve SAM header on the first file the user selected
    const output = await CLI.exec(`samtools view -H ${files[0].name}`);
    console.log(output);
}

document.getElementById("myfile").addEventListener("change", runSamtools, false);
</script>
```

### Working with large remote files

You can even mount URLs (as long as they are [CORS-enabled](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)):

```html
<script src="https://cdn.biowasm.com/v3/aioli/latest/aioli.js"></script>
<script type="module">
const CLI = await new Aioli("samtools/1.10");

// Mount a .bam and .bai from the 1000 Genomes Project. This lazy-mounts the URLs
// on the virtual file system, i.e. no data is downloaded yet.
const paths = await CLI.mount([
    "https://1000genomes.s3.amazonaws.com/phase3/data/NA12878/alignment/NA12878.chrom20.ILLUMINA.bwa.CEU.low_coverage.20121211.bam",
    "https://1000genomes.s3.amazonaws.com/phase3/data/NA12878/alignment/NA12878.chrom20.ILLUMINA.bwa.CEU.low_coverage.20121211.bam.bai"
]);

// Since the .bai index file is present, samtools only downloads a subset of the .bam!
// Check the "Network" tab in the developer console to confirm that.
const output = await CLI.exec(`samtools view ${paths[0]} 20:39,352,829-39,352,842`);
console.log(output);
</script>
```


### Useful functions

```javascript
// List files in a given directory on the virtual file system
await CLI.ls("/some/path");

// Convert a file on the virtual file system to a Blob object, and returns a URL so it can be downloaded by the user
const url = await CLI.download("/path/to/a/file");
```


### Using Aioli with npm

Instead of using `<script src="https://cdn.biowasm.com/v3/aioli/latest/aioli.js"></script>`, you can install Aioli using `npm`:

```bash
npm install --save "@biowasm/aioli"
```

Then you can import Aioli as follows:

```js
import Aioli from "@biowasm/aioli";
```

Note that even if you import Aioli locally, the WebAssembly modules will still be downloaded from the biowasm CDN unless you download those assets locally and specify their path using `urlPrefix`—see [the Advanced section](#Advanced) for details


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

By default, Aioli retrieves the `.wasm` modules and the Aioli WebWorker code from the biowasm CDN for convenience, but you can also load files from local sources. There are also additional configuration options you can pass along:

```javascript
new Aioli([{
    tool: "seq-align",
    version: "2017.10.18",
    program: "smith_waterman",              // Optional: custom program to run within the tool; not needed for most tools (default=same as "tool" name)
    urlPrefix: "./path/to/wasm/files/",     // Optional: custom path to .js/.wasm files; for local biowasm development (default=biowasm CDN)
    loading: "lazy",                        // Optional: if set to "lazy", only downloads WebAssembly modules when needed, instead of at initialization (default=eager)
}], {
    printInterleaved: true,                 // Optional: whether `exec()` returns interleaved stdout/stderr; if false, returns object with stdout/stderr keys (default=true)
    debug: false,                           // Optional: set to true to see console log messages for debugging (default=false)
});
```

## Tools using Aioli

See [Tools using biowasm](https://github.com/biowasm/biowasm#tools-using-biowasm)

## Architecture

* Aioli creates a single WebWorker, in which all WebAssembly tools run.
* We use a [PROXYFS virtual filesystem](https://emscripten.org/docs/api_reference/Filesystem-API.html#filesystem-api-proxyfs) so we can share a filesystem across all WebAssembly modules, i.e. the output of one tool can be used as the input of another tool.
* We use a [WORKERFS virtual filesystem](https://emscripten.org/docs/api_reference/Filesystem-API.html#filesystem-api-workerfs) to mount local files efficiently (i.e. without having to load all their contents into memory). To support use cases where tools need to create files in the same folder as those ready-only files (e.g. `samtools index`), we automatically create a symlink from each local file's WORKERFS path to a path in PROXYFS.
* Once the WebWorker initializes, it loads the WebAssembly modules one at a time. To support this, we need to encapsulate each module using Emscripten's `-s MODULARIZE=1`, i.e. the `.js` file will contain a `Module` function that initializes the module and returns a `Promise` that resolves when the module is loaded.
* We do WebAssembly feature detection at initialization using `wasm-feature-detect`. If a tool needs WebAssembly SIMD and the user has a browser that does not support it, we will load the non-SIMD version of that tool.
* We communicate with the WebWorker using the [Comlink](https://github.com/GoogleChromeLabs/comlink) library.


## Tests

Run `npm run test`.

## Background info

### What is WebAssembly?
[WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly) is a fast, low-level, compiled binary instruction format that runs in all major browsers at near native speeds. One key feature of WebAssembly is code reuse: you can port existing C/C++/Rust/etc tools to WebAssembly so those tools can run in the browser.

### What is a WebWorker?
[WebWorkers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) allow you to run JavaScript in the browser in a background thread, which keeps the browser responsive.

### Compiling into WebAssembly
See the [biowasm](https://github.com/biowasm/biowasm/) project.
