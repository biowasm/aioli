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

// Here we write to a file with one tool, and use it as input for another tool.
// Convert a ".sam" file to a ".fastq", and save the result to "./toy.fastq"
let output = await CLI.exec("samtools fastq -o toy.fastq /samtools/examples/toy.sam");

// Run the tool "seqtk" on "toy.fastq" to generate QC metrics
output = await CLI.exec("seqtk fqchk toy.fastq");
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
new Aioli({
    tool: "seq-align",
    version: "2017.10.18",
    program: "smith_waterman",              // Optional: custom program to run within the tool; not needed for most tools (default=same as "tool" name)
    urlPrefix: "./path/to/wasm/files/",     // Optional: custom path to .js/.wasm files; for local biowasm development (default=biowasm CDN)
    loading: "lazy",                        // Optional: if set to "lazy", only downloads WebAssembly modules when needed, instead of at initialization (default=eager)
}, {
    urlAioli: "./path/to/aioli.worker.js",  // Optional: custom path to aioli.js and aioli.worker.js; for local Aioli development (default=biowasm CDN)
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
* We do WebAssembly feature detection at initialization using the biowasm `config.json` file. If, for example, a tool needs WebAssembly SIMD and the user has a browser that does not support it, we will load the non-SIMD version of that tool.
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
