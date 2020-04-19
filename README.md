# Aioli

Aioli is a framework for building fast genomics web tools using [WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly) and WebWorkers.

## Tools that use Aioli

- [fastq.bio](https://github.com/robertaboukhalil/fastq.bio)
- [bam.bio](https://github.com/robertaboukhalil/bam.bio)
- [genomeribbon.com](https://github.com/MariaNattestad/Ribbon)

## Getting Started

Here is a simple example of Aioli in action running the genomics tool `samtools` on a user-provided file:

```html
<input id="myfile" type="file" multiple>
<script src="https://cdn.sandbox.bio/aioli/1.1.0/aioli.js"></script>

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

You can also install Aioli through npm: `npm install @biowasm/aioli`.


## Background info

### What is WebAssembly?
[WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly) is a very fast, low-level, compiled binary instruction format that runs in all major browsers at near native speeds.

### What is a WebWorker?
[WebWorkers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) allow you to run JavaScript in the browser in a background thread, which keeps the browser responsive.

### Compiling into WebAssembly
See the [biowasm](https://github.com/biowasm/biowasm/) repository.
