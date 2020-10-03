# Aioli

[![npm](https://img.shields.io/npm/v/@biowasm/aioli)](https://www.npmjs.com/package/@biowasm/aioli)

Aioli is a framework for building fast genomics web tools using [WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly) and [WebWorkers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API).

## Tools that use Aioli

- [fastq.bio](https://github.com/robertaboukhalil/fastq.bio)
- [bam.bio](https://github.com/robertaboukhalil/bam.bio)
- [genomeribbon.com](https://github.com/MariaNattestad/Ribbon)
- [alignment.sandbox.bio](https://github.com/robertaboukhalil/alignment-sandbox)

## Getting Started

As shown below, **you can obtain Aioli from our biowasm CDN**, or you can install it from npm: `npm install @biowasm/aioli` (use the npm option if you want to host Aioli module locally).

### A simple example

Here is a simple example of Aioli in action running the genomics tool `samtools` on a small `SAM` file:

```html
<script src="https://cdn.biowasm.com/aioli/latest/aioli.js"></script>
<script>
let samtools = new Aioli("samtools/1.10");

samtools
    .init()
    .then(() => {
        console.log("samtools is initialized");

        // Run samtools view command
        samtools.exec("view -q 20 /samtools/examples/toy.sam")
                .then(d => console.log(d.stdout));
    });
</script>
```

### Working with user files

```html
<input id="myfile" type="file" multiple>
<script src="https://cdn.biowasm.com/aioli/latest/aioli.js"></script>

<script>
let samtools = new Aioli("samtools/1.10");

// Initialize samtools and output the version
samtools
    .init()
    .then(() => samtools.exec("--version"))
    .then(d => console.log(d.stdout));

// When a user selects a .sam file from their computer,
// run `samtools view -q20` on the file
function loadFile(event)
{
    Aioli
        // First mount the file
        .mount(event.target.files[0])
        // Once it's mounted, run samtools view
        .then(file => samtools.exec(`view -q20 ${file.path}`))
        // Capture output
        .then(d => console.log(d.stdout));
}
document.getElementById("myfile").addEventListener("change", loadFile, false);
</script>
```


## Aioli Configuration

### Simple

```javascript
// -------------------------------------
// Format: <module>/<version>
// -------------------------------------

// Retrieve specific version (recommended for stability)
new Aioli("seqtk/1.2");

// Retrieve latest version
new Aioli("seqtk/latest");


// -------------------------------------
// Format: <module>/<program>/<version>
// -------------------------------------

// For most bioinformatics tools, <module> == <program>
new Aioli("seqtk/seqtk/1.2");

// But not always! Some bioinformatics tools have multiple tools
new Aioli("seq-align/smith_waterman/1.2");
```

### Advanced

By default, Aioli retrieves the `.wasm` modules and the Aioli WebWorker code from the biowasm CDN for convenience, but you can also load files from local sources:

```javascript
new Aioli({
    module: "seq-align",
    program: "smith_waterman",              // optional (defaults to $module)
    version: "latest",                      // optional (defaults to latest)
    urlModule: "./path/to/wasm/files/",     // optional (defaults to biowasm CDN)
    urlAioli: "./path/to/aioli.worker.js",  // optional (defaults to biowasm CDN)
});
```

## Background info

### What is WebAssembly?
[WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly) is a fast, low-level, compiled binary instruction format that runs in all major browsers at near native speeds. One key feature of WebAssembly is code reuse: you can port existing C/C++/Rust/etc tools to WebAssembly so those tools can run in the browser.

### What is a WebWorker?
[WebWorkers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) allow you to run JavaScript in the browser in a background thread, which keeps the browser responsive.

### Compiling into WebAssembly
See the [biowasm](https://github.com/biowasm/biowasm/) project.
