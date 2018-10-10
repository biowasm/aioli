// =============================================================================
// Aioli
// -----------------------------------------------------------------------------
// This file handles communication between the app and the WebWorker
// Requires browser support for WebWorkers, WebAssembly, ES6 Classes, and ES6 Promises
// =============================================================================

// Check for browser support
if(!(window.Worker && window.File && window.FileReader && window.WebAssembly))
    throw "Your browser is not supported";

DEBUG = false;
DIR_WASM = "../../../wasm";
DIR_WORKER = "node_modules/@robertaboukhalil/aioli/aioli.worker.js";
DIR_PAPAPARSE = "../../papaparse/papaparse.min.js";

class Aioli
{
    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(config)
    {
        // IDs for message passing with WebWorker
        this.n = -1;
        // Track WebWorker used
        this.worker = null;
        // Track promises (indexed by this.n)
        this.resolves = {};
        this.rejects = {};
        this.imports = config.imports;
        this.assets = [ DIR_PAPAPARSE ];

        // Validate
        var requiredKeys = ["imports"];
        for(var k of requiredKeys)
            if(!(k in config))
                Aioli.error(`Missing key <${k}>.`);

        // Launch WebWorker and watch for messages (make sure to bind "this")
        this.worker = new Worker(DIR_WORKER);
        this.worker.onmessage = this.workerCallback.bind(this);
    }

    // Initialize WebWorker
    init()
    {
        return this.workerSend("init", {
            debug: DEBUG,
            dir_wasm: DIR_WASM,
            imports: this.imports,
            assets: this.assets
        });
    }


    // -------------------------------------------------------------------------
    // Utility functions
    // -------------------------------------------------------------------------

    // Mount: config = { files:[], blobs:[] }
    mount(config)
    {
        return this.workerSend("mount", config);
    }

    // Launch WASM code
    exec(config)
    {
        return this.workerSend("exec", config);
    }

    // Sample from file (isValidChunk returns true if given chunk if valid)
    sample(file, isValidChunkFnName)
    {
        return this.workerSend("sample", {
            file: file,
            isValidChunk: isValidChunkFnName
        });
    }


    // -------------------------------------------------------------------------
    // Worker Communication
    // -------------------------------------------------------------------------

    // Callback called whenever get message back from WebWorker
    workerCallback(event)
    {
        var data = event.data;

        // Handle errors
        if(data.action == "error" && this.rejects[this.n] != null)
        {
            Aioli.error(data.id, "-", data.message);
            this.rejects[this.n]();
        }

        // Handle callback signal
        else if(data.action == "callback" && this.resolves[data.id] != null)
        {
            if(DEBUG)
                Aioli.info(data.id, "-", data.message);
            this.resolves[data.id](data.message);
        }
    }

    // Send message to worker
    workerSend(action, config)
    {
        return new Promise((resolve, reject) =>
        {
            this.n++;

            // Track resolve/reject functions so can call them when receive message back from worker
            this.resolves[this.n] = resolve;
            this.rejects[this.n] = reject;

            // Send message to worker
            this.worker.postMessage({
                id: this.n,
                action: action,
                config: config
            });
        });
    }


    // -------------------------------------------------------------------------
    // Error management
    // -------------------------------------------------------------------------

    static info() {
        console.info(`[Aioli]`, ...arguments);
    }

    static error() {
        console.error(`[Aioli]`, ...arguments);
    }
}
