# Aioli

Aioli is a framework for building fast genomics web tools using [WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly).

## Tools that use Aioli

- [fastq.bio](https://github.com/robertaboukhalil/fastq.bio)
- [bam.bio](https://github.com/robertaboukhalil/bam.bio)
- [genomeribbon.com](https://github.com/MariaNattestad/Ribbon)

## Getting Started

Here is a simple example of Aioli in action running the genomics tool `samtools` on a user-provided file:

```html
<input id="myfile" type="file" multiple>
<script src="aioli.js"></script>

<script>
let samtools = new Aioli("samtools/1.10");

// Initialize samtools and output the version
samtools
    .init()
    .then(() => samtools.exec("--version"))
    .then(d => {
        console.log(d.stdout);
    });

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
        .then(d => {
            console.log(d.stdout);
        });
}
document.getElementById("myfile").addEventListener("change", loadFile, false);
</script>
```

## Background info

### What is WebAssembly?
[WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly) is a very fast, low-level, compiled binary instruction format that runs in all major browsers at near native speeds.

### What is a WebWorker?
[WebWorkers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) allow you to run JavaScript in the browser in a background thread, which keeps the browser responsive.

### Compiling into WebAssembly
1. Download the [Emscriptem SDK](https://kripken.github.io/emscripten-site/docs/getting_started/downloads.html)
2. Follow the [Emscriptem tutorial](https://kripken.github.io/emscripten-site/docs/getting_started/Tutorial.html) for details on how to compile C/C++ files into `app.js` and `app.wasm`.
3. Use `template.html` as a starting point for building your app. Built on top of Aioli, this simple app allows users to specify a local file to parse (URLs + drag & drop supported), and will mount that file to a virtual file system inside a WebWorker, sample that file randomly, run a WebAssembly command on each chunk inside the WebWorker, track its output, and display progress throughout.
4. You can install Aioli as a JavaScript package through npm: `npm install @robertaboukhalil/aioli`.
