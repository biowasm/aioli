// =============================================================================
// WebWorker
// =============================================================================

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

KB = 1024;
MB = KB * KB;
DEBUG = false;
DIR_DATA = "/data";     // in virtual file system
DIR_WASM = "../wasm";   // in real file system
VALID_ACTIONS = [ "init", "mount", "exec", "sample" ];
REGEX_GZIP = /.gz$/g;

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

self.state = {
    // File management
    n: 0,           // file ID
    files: {},      // key: file ID, value: {id:n, sampling:AioliSampling}
    reader: new FileReader(),
    // Function management
    output: {},     // key: wasm function
    running: "",    // wasm function currently running
};


// =============================================================================
// Process incoming messages
// =============================================================================

self.onmessage = function(msg)
{
    var data = msg.data;
    var id = data.id,
        action = data.action,
        config = data.config;

    // Valid actions
    if(VALID_ACTIONS.indexOf(action) == -1) {
        AioliWorker.postMessage(id, `Invalid action <${action}>.`, "error");
        return;
    }

    // -------------------------------------------------------------------------
    // Handle actions
    // -------------------------------------------------------------------------

    if(action == "init")
    {
        console.time("AioliInit");
        AioliWorker.init(config);
        AioliWorker.postMessage(id);        
        console.timeEnd("AioliInit");
    }

    if(action == "mount")
    {
        console.time("AioliMount");
        AioliWorker.mount(config);
        AioliWorker.postMessage(id);
        console.timeEnd("AioliMount");
    }

    if(action == "exec")
    {
        self.state.running = id;
        console.time("AioliExec");
        AioliWorker.exec(config);
        console.timeEnd("AioliExec");
        self.state.running = "";
        // Send back output
        if(self.state.output[id] != null)
            AioliWorker.postMessage(id, Papa.parse(self.state.output[id], {
                dynamicTyping: true
            }));
    }

    if(action == "sample")
    {
        AioliWorker.sample(config).then(range => {
            AioliWorker.postMessage(id, range);
        }).catch(e => {
            console.error(`[AioliWorkerSample]: ${e}`);
        });
    }
}


// =============================================================================
// Emscripten module logic
// =============================================================================

// Defaults: don't auto-run WASM program once loaded
Module = {};
Module.noInitialRun = true;
Module.locateFile = url => `${DIR_WASM}/${url}`;
// // TODO: check effect of setting this
// Module.TOTAL_STACK = 50 * 1024 * 2014;
// Module.TOTAL_MEMORY = 160 * 1024 * 2014;

// Capture stdout
Module.print = text => {
    if(!(self.state.running in self.state.output))
        self.state.output[self.state.running] = "";
    self.state.output[self.state.running] += text + "\n";
};

Module.printErr = text => {
    console.warn(text);
}


// =============================================================================
// Aioli - Worker logic
// =============================================================================

class AioliWorker
{
    // -------------------------------------------------------------------------
    // Import scripts and make data folder
    // -------------------------------------------------------------------------
    static init(config)
    {
        DEBUG = config.debug;

        self.importScripts(
            'aioli.user.js',
            ...config.assets,
            ...config.imports.map(Module.locateFile)
        );
        FS.mkdir(DIR_DATA, 0o777);
    }

    // -------------------------------------------------------------------------
    // Mount file(s) and/or blob(s) to the Worker's file system
    // Can only mount a folder one at a time, so assign each file a folder
    // -------------------------------------------------------------------------
    static mount(config)
    {
        // Define folder for current batch of files
        self.state.n++;
        var dir = `${DIR_DATA}/${self.state.n}`;

        // Define file system to mount
        var fs = {}, filesAndBlobs = [];
        if("files" in config) {
            fs.files = config.files;
            filesAndBlobs = filesAndBlobs.concat(fs.files);
        }
        if("blobs" in config) {
            fs.blobs = config.blobs;
            filesAndBlobs = filesAndBlobs.concat(config.blobs);
        }

        // Create folder and mount
        FS.mkdir(dir, 0o777);
        FS.mount(WORKERFS, fs, dir);

        // Keep track of mounted files
        for(var f of filesAndBlobs)
            self.state.files[f.name] = {
                id: self.state.n,
                sampling: new AioliSampling(f)
            }

        return getFilePath(f);
    }

    // -------------------------------------------------------------------------
    // Execute WASM functions
    // -------------------------------------------------------------------------
    
    // Recursively parse command-line arguments, and replace File objects with mounted paths
    static execParse(args, chunk)
    {
        for(var i in args)
        {
            var c = args[i];

            // Is array?
            if(c.constructor === Array)
            {
                args[i] = AioliWorker.execParse(c);

            // Is File object?
            } else if(typeof(c) == "object" && "name" in c) {
                // If not sampling chunk, use path as is
                if(chunk == null)
                    args[i] = getFilePath(c);
                // Otherwise, first need to mount the chunk
                else {
                    args[i] = AioliWorker.mount({
                        blobs: [{
                            name: `sampled-${chunk.start}-${chunk.end}-${c.name}`,
                            data: c.slice(chunk.start, chunk.end)
                        }]
                    });
                }
            }
        }
        return args;
    }

    // Execute command
    static exec(config)
    {
        // Parse command-line args and convert File objects to paths
        config.args = AioliWorker.execParse(config.args, config.chunk);

        // Launch function
        if(DEBUG) console.time(`[AioliWorker] ${config.fn ? config.fn : "main"}()`);

        // Either call main() or custom function
        if(config.fn == null)
            Module.callMain(config.args);
        else if(config.argTypes != null && config.returnType != null)
            Module.ccall(config.fn, config.returnType, config.argTypes, config.args);

        if(DEBUG) console.timeEnd(`[AioliWorker] ${config.fn ? config.fn : "main"}()`);
    }


    // -------------------------------------------------------------------------
    // Sample file and return valid chunk range
    // -------------------------------------------------------------------------
    static sample(config)
    {
        var file = config.file,
            sampling = getFileInfo(file).sampling,
            fnValidChunk = CALLBACKS[config.isValidChunk];

        // Return promise
        return sampling.nextRegion(fnValidChunk);
    }

    // -------------------------------------------------------------------------
    // Send message from WebWorker back to app
    // -------------------------------------------------------------------------
    static postMessage(id, message="ready", action="callback")
    {
        self.postMessage({
            id: id,
            action: action,
            message: message
        });
    }
}


// =============================================================================
// Aioli - Sampling logic
// =============================================================================

class AioliSampling
{
    constructor(file)
    {
        this.file = file;         // File or Blob to sample from
        this.visited = [];        // List of ranges already visited
        this.redraws = 0;         // Number of consecutive times we redraw random positions to sample
        this.stopAtNext = false;  // If true, will sample this time, but stop the next iteration (used for small gzips)

        // TODO: make these configurable
        this.maxRedraws = 10;     // Max number of consecutive redraws
        this.chunkSize = 0.5 * MB;  // Chunk size to read from
        this.chunkSizeValid = 2 * KB;  // Chunk size to read to determine whether chunk if valid
        this.smallFileFactor = 5; // Define a small file as N * chunkSize
    }


    // -------------------------------------------------------------------------
    // Find next region to sample from file
    // -------------------------------------------------------------------------

    nextRegion(isValidChunk)
    {
        // Assume need to sample (unless .gz file)
        var doSample = true;
        // Will contain the sampling parameters to send back
        var sampling = {
            start: 0,
            end: 0,
            done: false
        };

        // If too many consecutive redraws, stop sampling
        // Also use redraws to sample further into a gzip file
        this.redraws++;
        if(this.redraws > this.maxRedraws || this.stopAtNext) {
            sampling.done = true;
            return new Promise((resolve, reject) => resolve(sampling));
        }

        // Special Cases
        // If gzip file, can't sample
        if(this.file.name.match(REGEX_GZIP)) {
            doSample = false;
            sampling.end = this.chunkSize * this.redraws;
            if(sampling.end > this.file.size)
            this.stopAtNext = true;
        // If small file, don't sample; use the whole file
        } else if(this.file.size <= this.chunkSize * this.smallFileFactor) {
            sampling.end = this.file.size;
        // Otherwise, sample randomly from file (test: startPos = 1068, endPos = 1780)
        } else {
            sampling.start = Math.floor(Math.random() * (this.file.size + 1));
            sampling.end = Math.min(sampling.start + this.chunkSize, this.file.size);
        }
        // If shouldn't sample, return resolved promise
        if(!doSample)
            return new Promise((resolve, reject) => resolve(sampling));

        // Have we already sampled this region?
        var reSample = false;
        for(var range of this.visited)
        {
            // --------vvvvvvvvvv---
            //            ssss->
            if(sampling.start >= range[0] && sampling.start <= range[1])
                // --------vvvvvvvvvv---
                //             ssss
                if(sampling.end <= range[1])
                    reSample = true;
                // --------vvvvvvvvvv---
                //                ssssss
                else
                    sampling.start = range[1];

            // --------vvvvvvvvvv---
            //            <-sss
            if(sampling.end >= range[0] && sampling.end <= range[1])
                // --------vvvvvvvvvv---
                //            sssss
                if(sampling.start >= range[0])
                    reSample = true;
                // --------vvvvvvvvvv---
                //    sssssssssssss
                else
                    sampling.end = range[0];

            if(reSample)
                break;
            if(DEBUG)
                console.log(`[AioliSampling] - ${sampling.start} --> ${sampling.end}`);
        }
        if(reSample)
            return this.nextRegion();
        else
            this.redraws = 0;

        // Narrow down sampling region to valid start byte
        return new Promise((resolve, reject) =>
        {
            self.state.reader.readAsBinaryString(this.file.slice(
                sampling.start,
                Math.min(sampling.end, sampling.start + this.chunkSizeValid)
            ));

            // Increment byte start till we get the correct byteOffset
            self.state.reader.onload = () => {
                var chunk = self.state.reader.result;
                var byteOffset = 0;
                if(typeof(isValidChunk) == "function")
                    while(!isValidChunk(chunk.slice(byteOffset)))
                        byteOffset++;

                // Mark current range as visited
                this.visited.push([ sampling.start + byteOffset, sampling.end ]);
                return resolve(sampling);
            };
        });
    }
}


// =============================================================================
// Utility functions
// =============================================================================

// Given File object, get its path on the virtual FS
function getFilePath(file)
{
    return `${DIR_DATA}/${getFileInfo(file).id}/${file.name}`;
}

// Given File object, return info about it
function getFileInfo(file)
{
    if(typeof(file) == "string")
        console.error(`[AioliWorker] Expecting File object, not string.`);
    if(!("name" in file))
        console.error(`[AioliWorker] Invalid File object; missing "name".`);
    if(!(file.name in self.state.files))
        console.error(`[AioliWorker] File specified <${file.name}> needs to be mounted first.`);
    return self.state.files[file.name];
}
