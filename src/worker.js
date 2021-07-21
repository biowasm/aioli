import * as Comlink from "comlink";
import { simd, threads } from "wasm-feature-detect";

const aioli = {
	// Configuration
	tools: [],   // Genomics tools that are available to use in this WebWorker
	config: {},  // See main.js for defaults
	files: [],   // File/Blob objects that represent local user files we mount to a virtual filesystem
	fs: {},      // Main WebAssembly module's filesystem (equivalent to aioli.tools[0].module.FS)

	// =========================================================================
	// Initialize the WebAssembly module(s)
	// Supports array of tool info, where each tool is represented by:
	// 		{
	// 			module: "samtools",                           // Required
	// 			version: "1.10",                              // Required
	// 			program: "samtools",                          // Optional, default="module" name. Only use this for tools with multiple subtools
	// 			urlPrefix: "https://cdn.biowasm.com/v2/...",  // Optional, default=biowasm CDN. Only use for local Aioli development
	// 		},
	// =========================================================================
	async init()
	{
		// Load each tool
		for(let i in aioli.tools)
		{
			const tool = aioli.tools[i];

			// -----------------------------------------------------------------
			// Set default settings
			// -----------------------------------------------------------------
			// By default, use the CDN path, but also accept custom paths for each tool
			if(!tool.urlPrefix)
				tool.urlPrefix = `${aioli.config.urlCDN}/${tool.module}/${tool.version}`;

			// In most cases, the program is the same as the module, but there are exceptions. For example, for the
			// module "seq-align", program can be "needleman_wunsch", "smith_waterman", or "lcs".
			if(!tool.program)
				tool.program = tool.module;

			aioli._log(`Loading ${tool.program} v${tool.version}`);

			// SIMD and Threads are WebAssembly features that aren't enabled on all browsers. In those cases, we
			// load the right version of the .wasm binaries based on what is supported by the user's browser.
			const toolConfig = await fetch(`${tool.urlPrefix}/config.json`).then(d => d.json());
			if(toolConfig["wasm-features"]?.includes("simd") && !await simd()) {
				console.warn(`[biowasm] SIMD is not supported in this browser. Loading slower non-SIMD version of ${tool.program}.`);
				tool.program += "-nosimd";
			}
			if(toolConfig["wasm-features"]?.includes("threads") && !await threads()) {
				console.warn(`[biowasm] Threads are not supported in this browser. Loading slower non-threaded version of ${tool.program}.`);
				tool.program += "-nothreads";
			}

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
				printErr: text => tool.stderr += `${text}\n`
			});

			// Initialize variables
			tool.stdout = "";
			tool.stderr = "";

			// -----------------------------------------------------------------
			// Setup shared virtual file system
			// -----------------------------------------------------------------

			// The first tool we initialize (i.e. base module) has the main filesystem, which other tools will mount
			const FS = tool.module.FS;
			if(i == 0) {
				// Create needed folders
				FS.mkdir(aioli.config.dirData, 0o777);
				FS.mkdir(aioli.config.dirMounted, 0o777);
				// Set the working directory for convenience
				FS.chdir(aioli.config.dirData);

				// Track this filesystem so we don't need to do aioli.tools[0].module.FS every time
				aioli.fs = FS;
			} else {
				// PROXYFS allows use to point "/shared" to the base module's filesystem "/"
				FS.mkdir(aioli.config.dirShared);
				FS.mount(tool.module.PROXYFS, {
					root: "/",
					fs: aioli.fs
				}, aioli.config.dirShared);

				// Set the working directory to be that mount folder for convenience
				FS.chdir(`${aioli.config.dirShared}${aioli.config.dirData}`);
			}
		}

		aioli._log("Ready");
		return true;
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
		aioli.fs.mount(aioli.tools[0].module.WORKERFS, {
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
				aioli.tools[1].module.FS.unlink(newpath);
			} catch(e) {}
			aioli._log(`Creating symlink: ${newpath} --> ${oldpath}`)

			// Create symlink within first module's filesystem (note: tools[0] is always the "base" biowasm module)
			aioli.tools[1].module.FS.symlink(oldpath, newpath);
		})

		return mountedPaths.map(path => `${dirShared}${dirData}/${path}`);
	},

	// =========================================================================
	// Execute a command
	// =========================================================================
	async exec(command)
	{
		// Input validation
		aioli._log(`Executing: %c${command}%c`, "color:darkblue; font-weight:bold");
		if(!command)
			throw "Expecting a command";
		// Extract tool name 
		const args = command.split(" ");
		const toolName = args.shift();

		// Does it match a program we've already loaded?
		const tools = aioli.tools.filter(d => d.program == toolName);
		if(tools.length == 0)
			throw `Program ${toolName} not found.`;
		// Prepare tool
		const tool = tools[0];		
		tool.stdout = "";
		tool.stderr = "";

		// Run command. Stdout/Stderr will be saved to "tool.stdout"/"tool.stderr" (see "print" and "printErr" above)
		tool.module.callMain(args);

		// Re-open stdout/stderr (fix error "error closing standard output: -1")
		tool.module.FS.streams[1] = tool.module.FS.open("/dev/stdout", "w");
		tool.module.FS.streams[2] = tool.module.FS.open("/dev/stderr", "w");

		return {
			stdout: tool.stdout,
			stderr: tool.stderr
		}
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

	// =========================================================================
	// Utilities
	// =========================================================================
	_fileop(operation, path) {
		aioli._log(`Running ${operation} ${path}`);

		// Check whether the file exists
		const FS = aioli.tools[1].module.FS;
		const info = FS.analyzePath(path);
		if(!info.exists)
			return false;

		// Execute operation of interest
		switch (operation) {
			case "cat":
				return FS.readFile(path, { encoding: "utf8" });
				break;
		
			case "ls":
				if(FS.isFile(info.object.mode))
					return FS.stat(path);
				return FS.readdir(path);
				break;

			case "download":
				const blob = new Blob([ this.cat(path) ]);
				return URL.createObjectURL(blob);
				break;
		}

		return false;
	},

	_log(message) {
		if(!aioli.config.debug)
			return;

		// Support custom %c arguments
		let args = [...arguments];
		args.shift();
		console.log(`%c[WebWorker]%c ${message}`, "font-weight:bold", "", ...args);
	}
};

Comlink.expose(aioli);
