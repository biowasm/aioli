import { expose } from "comlink";
import { simd } from "wasm-feature-detect";

const LOADING_EAGER = "eager";
const LOADING_LAZY = "lazy";

// Hardcode wasm features to avoid downloading a "config.json" for every tool.
// As a result, adding a SIMD package to biowasm requires updating Aioli, but
// there are very few packages that will require that.
const WASM_FEATURES = {
	"ssw": ["simd"],
	"minimap2": ["simd"]
};

// Main Aioli logic
const aioli = {
	// State
	tools: [],      // Genomics tools that are available to use in this WebWorker
	config: {},     // See main.js for defaults
	files: [],      // File/Blob objects that represent local user files we mount to a virtual filesystem
	baseModule: {}, // Base module (== aioli.tools[0])
	fs: {},         // Base module's filesystem (== aioli.tools[0].module.FS)

	// =========================================================================
	// Initialize the WebAssembly module(s)
	// Supports array of tool info, where each tool is represented by:
	// 		{
	// 			tool: "samtools",                             // Required
	// 			version: "1.10",                              // Required
	// 			program: "samtools",                          // Optional, default="tool" name. Only use this for tools with multiple subtools
	// 			urlPrefix: "https://cdn.biowasm.com/v3/...",  // Optional, default=biowasm CDN. Only use for local biowasm development
	// 			loading: "eager",                             // Optional, default="eager". Set to "lazy" to only load modules when they are used in exec()
	// 			reinit: false,                                // Optional, default="false". Set to "true" to reinitialize a module after each invocation
	// 		},
	// =========================================================================
	async init()
	{
		// Expect at least 1 module
		if(aioli.tools.length === 0)
			throw "Expecting at least 1 tool.";

		// ---------------------------------------------------------------------
		// Set up base module (do that first so that its filesystem is ready for
		// the other modules to mount in parallel)
		// ---------------------------------------------------------------------

		// First module can't be lazy-loaded because that's where the main filesystem is mounted
		aioli.base = aioli.tools[0];
		aioli.base.loading = LOADING_EAGER;
		await this._setup(aioli.base);
		aioli.fs = aioli.base.module.FS;

		// The base module has the main filesystem, which other tools will mount
		const dirShared = aioli.config.dirShared;
		aioli.fs.mkdir(dirShared, 0o777);
		aioli.fs.mkdir(`${dirShared}/${aioli.config.dirData}`, 0o777);
		aioli.fs.mkdir(`${dirShared}/${aioli.config.dirMounted}`, 0o777);
		aioli.fs.chdir(`${dirShared}/${aioli.config.dirData}`);

		// ---------------------------------------------------------------------
		// Initialize all other modules
		// ---------------------------------------------------------------------

		await this._initModules();
		aioli._log("Ready");
		return true;
	},

	// Initialize all modules that should be eager-loaded (i.e. not lazy-loaded)
	async _initModules() {
		// Initialize WebAssembly modules in parallel (though can't call importScripts in parallel)
		await Promise.all(aioli.tools.map(tool => this._setup(tool)));

		// Setup filesystems so that tools can access each other's sample data
		await this._setupFS();
	},

	// =========================================================================
	// Mount files to the virtual file system
	// Supports <FileList>, <File>, <Blob>, and string URLs:
	//		mount(<FileList>)
	//		mount([ <File>, { name: "blob.txt", data: <Blob> }, "https://somefile.com" ])
	// =========================================================================
	mount(files)
	{
		const dirData = aioli.config.dirData;
		const dirShared = aioli.config.dirShared;
		const dirMounted = aioli.config.dirMounted;

		// Input validation. Note that FileList is not an array so we can't use Array.isArray() but it does have a
		// length attribute. So do strings, which is why we explicitly check for those.
		let toMount = [], mountedPaths = [];
		if(!files?.length || typeof files === "string")
			files = [ files ];
		aioli._log(`Mounting ${files.length} files`);

		// Sort files by type: File vs. Blob vs. URL
		for(let file of files)
		{
			// Handle File/Blob objects
			// Blob formats: { name: "filename.txt", data: new Blob(['blob data']) }
			if(file instanceof File || (file?.data instanceof Blob && file.name)) {
				toMount.push(file);
				mountedPaths.push(file.name);

			// Handle URLs: mount "https://website.com/some/path.js" to "/urls/website.com-some-path.js")
			} else if(typeof file == "string" && file.startsWith("http")) {
				// Mount a URL "lazily" to the file system, i.e. don't download any of it, but will automatically do
				// HTTP Range requests when a tool requests a subset of bytes from that file.
				const fileName = file.split("//").pop().replace(/\//g, "-");
				aioli.fs.createLazyFile(dirData, fileName, file, true, true);
				mountedPaths.push(fileName);

			// Otherwise, incorrect data provided
			} else {
				throw "Cannot mount file(s) specified. Must be a File, Blob, or a URL string.";
			}
		}

		// Unmount and remount Files and Blobs since WORKERFS is read-only (i.e. can only mount a folder once)
		try {
			aioli.fs.unmount(dirMounted);
		} catch(e) {}

		// Mount File & Blob objects
		aioli.files = aioli.files.concat(toMount);
		aioli.fs.mount(aioli.base.module.WORKERFS, {
			files: aioli.files.filter(f => f instanceof File),
			blobs: aioli.files.filter(f => f?.data instanceof Blob)
		}, dirMounted);

		// Create symlinks for convenience. The folder "dirMounted" is a WORKERFS, which is read-only. By adding
		// symlinks to a separate writeable folder "dirData", we can support commands like "samtools index abc.bam",
		// which create a "abc.bam.bai" file in the same path where the .bam file is created.
		toMount.map(file => {
			const oldpath = `${dirShared}${dirMounted}/${file.name}`;
			const newpath = `${dirShared}${dirData}/${file.name}`;
			try {
				aioli.fs.unlink(newpath);
			} catch(e) {}
			aioli._log(`Creating symlink: ${newpath} --> ${oldpath}`)

			// Create symlink within first module's filesystem (note: tools[0] is always the "base" biowasm module)
			aioli.fs.symlink(oldpath, newpath);
		})

		return mountedPaths.map(path => `${dirShared}${dirData}/${path}`);
	},

	// =========================================================================
	// Execute a command
	// =========================================================================
	async exec(command, args=null) {
		// Input validation
		aioli._log(`Executing %c${command}%c args=${args}`, "color:darkblue; font-weight:bold", "");
		if(!command)
			throw "Expecting a command";
		// Extract tool name and arguments
		let toolName = command;
		if(args == null) {
			args = command.split(" ");
			toolName = args.shift();
		}

		// Does it match a program we've already initialized?
		const tools = aioli.tools.filter(t => {
			let tmpToolName = toolName;
			// Take special WebAssembly features into account
			if(t?.features?.simd === true)
				tmpToolName = `${tmpToolName}-simd`;
			return t.program == tmpToolName;
		});
		if(tools.length == 0)
			throw `Program ${toolName} not found.`;
		// Prepare tool
		const tool = tools[0];		
		tool.stdout = "";
		tool.stderr = "";

		// If this is a lazy-loaded module, load it now by setting it to eager loading.
		// Note that calling _initModules will only load modules that haven't yet been loaded.
		if(tool.loading == LOADING_LAZY) {
			tool.loading = LOADING_EAGER;
			await this._initModules();
		}

		// Run command. Stdout/Stderr will be saved to "tool.stdout"/"tool.stderr" (see "print" and "printErr" above)
		try {
			tool.module.callMain(args);
		} catch (error) {
			console.error(error)
		}

		// Flush stdout/stderr to make sure we got everything. Otherwise, if use a command like 
		// `bcftools query -f "%ALT" variants.bcf`, it won't output anything until the next
		// invocation of that command!
		try {
			tool.module.FS.close( tool.module.FS.streams[1] );
			tool.module.FS.close( tool.module.FS.streams[2] );
		} catch (error) {}
		// Re-open stdout/stderr (fix error "error closing standard output: -1")
		tool.module.FS.streams[1] = tool.module.FS.open("/dev/stdout", "w");
		tool.module.FS.streams[2] = tool.module.FS.open("/dev/stderr", "w");

		// Return output, either stdout/stderr interleaved, or each one separately
		let result = { stdout: tool.stdout, stderr: tool.stderr };
		if(aioli.config.printInterleaved)
			result = tool.stdout;

		// Reinitialize module after done? This is useful for tools that don't properly reset their global state the
		// second time the `main()` function is called.
		if(tool.reinit === true) {
			// Save working directory so we can return to it after reinitialization
			const pwd = tool.module.FS.cwd();
			// Reset config
			Object.assign(tool, tool.config);
			tool.ready = false;
			// Reinitialize module + setup FS
			await this._setup(tool);
			await this._setupFS();
			this.cd(pwd);
		}

		return result;
	},

	// =========================================================================
	// Utility functions for common file operations
	// =========================================================================
	cat(path) {
		return aioli._fileop("cat", path);
	},

	ls(path) {
		return aioli._fileop("ls", path);
	},

	download(path) {
		return aioli._fileop("download", path);
	},

	cd(path) {
		for(let tool of aioli.tools) {
			// Ignore modules that haven't been initialized yet (i.e. lazy-loaded modules)
			const module = tool.module;
			if(!module)
				continue;
			tool.module.FS.chdir(path);
		}
	},

	mkdir(path) {
		aioli.fs.mkdir(path);
		return true;
	},

	// =========================================================================
	// Initialize a tool
	// =========================================================================

	async _setup(tool) {
		if(tool.ready)
			return;

		// Save original config in case need them to reinitialize (use Object.assign to avoid ref changes)
		tool.config = Object.assign({}, tool);

		// -----------------------------------------------------------------
		// Set default settings
		// -----------------------------------------------------------------

		// By default, use the CDN path, but also accept custom paths for each tool
		if(!tool.urlPrefix)
			tool.urlPrefix = `${aioli.config.urlCDN}/${tool.tool}/${tool.version}`;

		// In most cases, the program is the same as the tool name, but there are exceptions. For example, for the
		// tool "seq-align", program can be "needleman_wunsch", "smith_waterman", or "lcs".
		if(!tool.program)
			tool.program = tool.tool;

		// SIMD isn't enabled on all browsers. Load the right .wasm file based on the user's browser
		if(!tool.features) {
			tool.features = {};
			const wasmFeatures = WASM_FEATURES[tool.program] || [];
			if(wasmFeatures.includes("simd") && await simd()) {
				aioli._log(`SIMD is not supported in this browser. Loading non-SIMD version of ${tool.program}.`);
				tool.program += "-simd";
				tool.features.simd = true;
			}
		}

		// If want lazy loading, don't go any further
		if(tool.loading == LOADING_LAZY)
			return;

		// -----------------------------------------------------------------
		// Import the WebAssembly module
		// -----------------------------------------------------------------

		// All biowasm modules export the variable "Module" so assign it
		self.importScripts(`${tool.urlPrefix}/${tool.program}.js`);

		// Initialize the Emscripten module and pass along settings to overwrite
		tool.module = await Module({
			// By default, tool name is hardcoded as "./this.program"
			thisProgram: tool.program,
			// Used by Emscripten to find path to .wasm / .data files
			locateFile: (path, prefix) => `${tool.urlPrefix}/${path}`,
			// Setup print functions to store stdout/stderr output
			print: text => tool.stdout += `${text}\n`,
			printErr: aioli.config.printInterleaved ? text => tool.stdout += `${text}\n` : text => tool.stderr += `${text}\n`
		});

		// -----------------------------------------------------------------
		// Setup shared virtual file system
		// -----------------------------------------------------------------

		if(tool !== aioli.base) {
			// PROXYFS allows us to point "/shared" to the base module's filesystem "/shared"
			const FS = tool.module.FS;
			FS.mkdir(aioli.config.dirShared);
			FS.mount(tool.module.PROXYFS, {
				root: aioli.config.dirShared,
				fs: aioli.fs
			}, aioli.config.dirShared);

			// Set the working directory to be that mount folder for convenience
			FS.chdir(`${aioli.config.dirShared}${aioli.config.dirData}`);
		}

		// -----------------------------------------------------------------
		// Initialize variables
		// -----------------------------------------------------------------

		tool.stdout = "";
		tool.stderr = "";
		tool.ready = true;
	},

	// Some tools have preloaded files mounted to their filesystems to hold sample data (e.g. /samtools/examples/).
	// By default, those are only accessible from the filesystem of the respective tool. Here, we want to allow
	// other modules to also have access to those sample data files.
	async _setupFS()
	{
		// Mount every tool's sample data onto the base module (including base module's own sample data)
		const fsDst = aioli.fs;
		for(let tool of aioli.tools) {
			const fsSrc = tool.module.FS;
			const pathSrc = `/${tool.tool}`;
			const pathDest = `${aioli.config.dirShared}${pathSrc}`;
			if(!fsSrc.analyzePath(pathSrc).exists)
				continue;

			aioli._log(`Mounting ${pathSrc} onto ${aioli.base.tool} filesystem at ${pathDest}`);
			fsDst.mkdir(pathDest);
			fsDst.mount(aioli.base.module.PROXYFS, {
				root: pathSrc,
				fs: fsSrc
			}, pathDest);
		}
	},

	// =========================================================================
	// Utilities
	// =========================================================================

	// Common file operations
	_fileop(operation, path) {
		aioli._log(`Running ${operation} ${path}`);

		// Check whether the file exists
		const info = aioli.fs.analyzePath(path);
		if(!info.exists) {
			aioli._log(`File ${path} not found.`);
			return false;
		}

		// Execute operation of interest
		switch (operation) {
			case "cat":
				return aioli.fs.readFile(path, { encoding: "utf8" });
		
			case "ls":
				if(aioli.fs.isFile(info.object.mode))
					return aioli.fs.stat(path);
				return aioli.fs.readdir(path);

			case "download":
				const blob = new Blob([ this.cat(path) ]);
				return URL.createObjectURL(blob);
		}

		return false;
	},

	// Log if debug enabled
	_log(message) {
		if(!aioli.config.debug)
			return;

		// Support custom %c arguments
		let args = [...arguments];
		args.shift();
		console.log(`%c[WebWorker]%c ${message}`, "font-weight:bold", "", ...args);
	}
};

expose(aioli);
