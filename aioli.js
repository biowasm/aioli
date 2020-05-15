// Notes:
// - Files mounted after WebWorkers are initialized will be auto-mounted on each Worker
// - WebAssembly module and WebWorker initialization code downloaded from cdn.sandbox.bio
// - Mounting URLs uses lazy-loading to fetch information as needed

class Aioli
{
    // =========================================================================
    // Properties
    // =========================================================================

    // Module:
    //  ready = false;      // Will be true when the module is ready
    //  urlModule = "";     // URL path to module

    // WebWorker:
    //  worker = null;      // WebWorker this module communicates with
    //  resolves = {};      // Track Promise functions for each message we send to the Worker
    //  rejects = {};

    // =========================================================================
    // Configs and defaults
    // =========================================================================

    static get config() {
        return {
            debug: false,
            // Files on virtual file system
            dirFiles: "/data",
            dirURLs: "/urls",
            // URLs to code
            urlModules: "https://cdn.sandbox.bio",
            urlWorkerJS: "https://cdn.sandbox.bio/aioli/latest/aioli.worker.js",
        }
    }

    // =========================================================================
    // Initialization
    // =========================================================================

    // Create module
    // e.g. Aioli("samtools/1.10") --> cdn.sandbox.bio/samtools/1.10/worker.{js,wasm}
    constructor(module)
    {
        // Initialize properties
        this.ready = false;
        this.urlModule = "";
        this.worker = null;
        this.resolves = {};
        this.rejects = {};

        // Input validation
        if(typeof module != "string")
            throw "Must provide a string to the Aioli constructor";

        // By default, modules are hosted on sandbox.bio
        if(!module.startsWith("http"))
            module = `${Aioli.config.urlModules}/${module}`;

        module += "/worker.js";
        this.urlModule = module;
    }

    // Download module code and launch WebWorker
    async init()
    {
        // Load Aioli worker JS
        const workerResponse = await fetch(Aioli.config.urlWorkerJS);
        const workerJS = await workerResponse.text();

        // Load compiled .wasm module JS
        const moduleResponse = await fetch(this.urlModule);
        const moduleJS = await moduleResponse.text();

        // Prepend Aioli worker code to the module (one alternative would be to launch an Aioli
        // WebWorker that imports the module code and eval(), but would rather avoid that)
        const js = workerJS + "\n" + moduleJS;
        const blob = new Blob([js], { type: "application/javascript" });
        this.worker = new Worker(URL.createObjectURL(blob));

        // Worker will make contact when ready
        // Note: without `.bind(this)`, `this` refers to the Worker object, not the Aioli object
        this.worker.onmessage = this.receive.bind(this);

        // Keep track of the WebWorkers we've launched overall. This will be useful when
        // we need to mount a File to all workers using Aioli.mount()
        Aioli.workers = Aioli.workers.concat(this);

        // Send a message to the worker so it initializes
        return this
            .send("init")
            .then(() => {
                this.ready = true;
                return new Promise(resolve => resolve("ready"));
            });
    }


    // =========================================================================
    // Worker Communication
    // =========================================================================

    send(action, data, transferables=[])
    {
        // API: what to do when sending messages
        const id = Aioli.uuid();
        return new Promise((resolve, reject) =>
        {
            // Track resolve/reject functions so can call them when receive message back from worker
            this.resolves[id] = resolve;
            this.rejects[id] = reject;

            // Send message to worker
            Aioli.log(`Sending: Action=%c${action}%c; Data=%c${JSON.stringify(data)} %c[id=${id}]`, "color:deepskyblue; font-weight:bold", "", "color:deepskyblue; font-weight:bold");
            this.worker.postMessage({
                id: id,
                action: action,
                data: data
            }, transferables);
        });
    }

    receive(message)
    {
        // Parse message
        const id = message.data.id;
        const data = message.data.data;
        const action = message.data.action;

        Aioli.log(`Worker Says: Action=%c${action}%c; Data=%c${JSON.stringify(data)} %c[id=${id}]`, "color:green; font-weight:bold", "", "color:green; font-weight:bold");
        Aioli.log('================')

        // Resolve promise
        if(action == "callback")
            this.resolves[id](data);
        else if(action == "error")
            this.rejects[id](data);
        else
            throw "Invalid action received from worker.";
    }


    // =========================================================================
    // Execute commands in the WebWorker
    // =========================================================================

    // Call main with custom arguments
    exec(command)
    {
        return this.send("exec", command);
    }

    // File system operations
    ls(path="/")
    {
        return this.send("ls", path);
    }
    cat(path)
    {
        return this.send("cat", path);
    }
    download(path)
    {
        return this.send("download", path);
    }

    // Custom file system operations. For example:
    //   FS.readFile("/file.txt", { encoding: "utf8" });
    // becomes:
    //   aioli.fs("readFile", "/file.txt", { encoding: "utf8" })
    // Supported FS operations: <https://emscripten.org/docs/api_reference/Filesystem-API.html>
    fs()
    {
        // Convert function arguments into array (`arguments` is an object)
        let args = [...arguments];
        return this.send("fs", {
            fn: args.shift(),
            args: args
        });
    }

    // =========================================================================
    // Worker Management: Track workers that Aioli is managing so that e.g. it
    // can be notified when a new file is mounted
    // =========================================================================

    static get workers() { return this._workers || []; }
    static set workers(workers) { this._workers = workers; }


    // =========================================================================
    // File Management
    // =========================================================================

    static get files() { return this._files || []; }
    static set files(files) { this._files = files; }

    // ------------------------------------------------------------------------
    // Transfer a mounted file from a worker to another
    // ------------------------------------------------------------------------
    static transfer(path, workerFrom, workerTo)
    {
        // Create a communication channel the workers can use
        const channel = new MessageChannel();

        // Ask the workers to transfer a file
        return Promise.all([
            workerFrom.send("transfer", { role: "sender", path: path, port: channel.port1 }, [channel.port1]),
            workerTo.send("transfer", { role: "receiver", path: path, port: channel.port2 }, [channel.port2])
        ]);
    }

    // ------------------------------------------------------------------------
    // Mount a File, Blob or string URL
    // ------------------------------------------------------------------------
    static mount(file, name=null, directory=null)
    {
        let mountedFile = {};

        // Input validation
        if(directory == Aioli.config.dirFiles || directory == Aioli.config.dirURLs)
            throw "Can't mount a file to a system directory.";

        // Handle File and Blob objects
        if(file instanceof File || file instanceof Blob)
        {
            // Set defaults
            name = name || file.name;
            directory = directory || Aioli.config.dirFiles;

            // Create a copy of the File object (not the file contents)
            // mountedFile = new File([ file ], name);
            mountedFile.file = file;
            mountedFile.source = "file";
        }

        // Handle URLs
        else if(typeof file == "string" && file.startsWith("http"))
        {
            // Set defaults (if no name provided: "https://website.com/some/path.js" mounts to "/urls/website.com-some-path.js")
            name = name || file.split("//").pop().replace(/\//g, "-");
            directory = directory || Aioli.config.dirURLs;

            // For URLs, we just use an object, not a File object
            mountedFile.url = file;
            mountedFile.source = "url";
        }

        // Otherwise error out
        else throw "Only support mounting File, Blob, or string URL";

        // Keep track of this new file
        mountedFile.name = name;
        mountedFile.path = `${directory}/${name}`;
        mountedFile.directory = directory;
        Aioli.files = Aioli.files.concat(mountedFile);

        // Notify attached workers to mount a new file?
        let promises = [];
        for(let worker of Aioli.workers)
            promises.push(worker.send("mount", mountedFile));

        return Promise.all(promises)
                      .then(d => new Promise(resolve => resolve(mountedFile)));
    }


    // =========================================================================
    // Utility functions
    // =========================================================================

    // Output message on console
    static log(message)
    {
        if(!Aioli.debug)
            return;

        // Get all arguments except `message`
        let args = [...arguments];
        args.shift();
        console.log(`%c[MainThread]%c ${message}`, "font-weight:bold", "", ...args);
    }

    // UUID v4: https://stackoverflow.com/a/2117523
    static uuid()
    {
        return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
    }
}

// Export module if applicable
if(typeof module !== 'undefined' && module.exports)
    module.exports = { Aioli };
