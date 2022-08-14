# Aioli

[![npm](https://img.shields.io/npm/v/@biowasm/aioli)](https://www.npmjs.com/package/@biowasm/aioli) ![Aioli Tests](https://github.com/biowasm/aioli/workflows/Aioli%20Tests/badge.svg)

Aioli is a library for running genomics command-line tools in the browser using WebAssembly. See [Who uses biowasm](https://github.com/biowasm/biowasm#who-uses-biowasm) for example use cases.

## Getting started

* [Documentation](https://biowasm.com/documentation)
* [List of supported packages](https://biowasm.com/cdn)

## Development

### Setup

Run `npm install` to install dependencies.

Then run `npm run dev` to launch the web server and use `src/example.js` as a sample web app that uses the dev version of Aioli.

### Tests

Run `npm run test`.

### Deploy a new release candidate

* Update version in `package.json` (append `-rc1` for release candidates)
* Build: `npm run build`
* Create npm package: `npm pack`
* Publish package: `npm publish [tgzfile] --tag next`
* To use pre-release version: `npm install @biowasm/aioli@next`

### Deploy a new version

* Update version in `package.json`
* Build: `npm run build`
* Publish package: `npm publish --access public`
* Create release in the GitHub repo
* Add to [`biowasm.json`](https://github.com/biowasm/biowasm/blob/main/biowasm.json) and deploy biowasm CDN

## Architecture

* Aioli creates a single WebWorker, in which all WebAssembly tools run.
* We use a [PROXYFS virtual filesystem](https://emscripten.org/docs/api_reference/Filesystem-API.html#filesystem-api-proxyfs) so we can share a filesystem across all WebAssembly modules, i.e. the output of one tool can be used as the input of another tool.
* We use a [WORKERFS virtual filesystem](https://emscripten.org/docs/api_reference/Filesystem-API.html#filesystem-api-workerfs) to mount local files efficiently (i.e. without having to load all their contents into memory). To support use cases where tools need to create files in the same folder as those ready-only files (e.g. `samtools index`), we automatically create a symlink from each local file's WORKERFS path to a path in PROXYFS.
* Once the WebWorker initializes, it loads the WebAssembly modules one at a time. To support this, we need to encapsulate each module using Emscripten's `-s MODULARIZE=1`, i.e. the `.js` file will contain a `Module` function that initializes the module and returns a `Promise` that resolves when the module is loaded.
* We do WebAssembly feature detection at initialization using `wasm-feature-detect`. If a tool needs WebAssembly SIMD and the user has a browser that does not support it, we will load the non-SIMD version of that tool.
* We communicate with the WebWorker using the [Comlink](https://github.com/GoogleChromeLabs/comlink) library.

## Background info

### What is WebAssembly?
[WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly) is a fast, low-level, compiled binary instruction format that runs in all major browsers at near native speeds. One key feature of WebAssembly is code reuse: you can port existing C/C++/Rust/etc tools to WebAssembly so those tools can run in the browser.

### What is a WebWorker?
[WebWorkers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) allow you to run JavaScript in the browser in a background thread, which keeps the browser responsive.

### Compiling into WebAssembly
See the [biowasm](https://github.com/biowasm/biowasm/) project.
