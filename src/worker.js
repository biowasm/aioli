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
	// 			module: "seq-align",
	//			program: "smith_waterman",                    // Optional, default="module" name. Only use this for tools with multiple subtools
	// 			version: "latest",                            // Optional, default="latest"
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

			// Unless specified, we want to use the latest version of a tool
			if(!tool.version)
				tool.version = "latest";

			// In most cases, the program is the same as the module, but there are exceptions. For example, for the
			// module "seq-align", program can be "needleman_wunsch", "smith_waterman", or "lcs".
			if(!tool.program)
				tool.program = tool.module;

			// SIMD and Threads are WebAssembly features that aren't enabled on all browsers. In those cases, we
			// load the right version of the .wasm binaries based on what is supported by the user's browser.
			const toolConfig = await fetch(`${tool.urlPrefix}/config.json`).then(d => d.json());
			if(toolConfig["wasm-features"]?.includes("simd") && !await simd()) {
				console.warn(`[Aioli] SIMD is not supported in this browser. Loading slower non-SIMD version of ${tool.program}.`);
				tool.program += "-nosimd";
			}
			if(toolConfig["wasm-features"]?.includes("threads") && !await threads()) {
				console.warn(`[Aioli] Threads are not supported in this browser. Loading slower non-threaded version of ${tool.program}.`);
				tool.program += "-nothreads";
			}

			// -----------------------------------------------------------------
			// Import the WebAssembly module
			// -----------------------------------------------------------------
			// All biowasm modules export the variable "Module" so assign it
			self.importScripts(`${tool.urlPrefix}/${tool.program}.js`);
			tool.module = await Module({
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

			// The first tool we initialize has the main filesystem, which other tools will mount
			const FS = tool.module.FS;
			if(i == 0)
			{
				// Create needed folders
				FS.mkdir(aioli.config.dirData, 0o777);
				FS.mkdir(aioli.config.dirMounted, 0o777);

				// Set the working directory to be that mount folder for convenience
				FS.chdir(aioli.config.dirData);

				// Track this filesystem so we don't need to do aioli.tools[0].module.FS every time
				aioli.fs = FS;
			} else {
				FS.mkdir(aioli.config.dirShared);
				FS.mount(tool.module.PROXYFS, {
					root: "/",
					fs: aioli.fs  // mount the first tool's filesystem
				}, aioli.config.dirShared);

				// Set the working directory to be that mount folder for convenience
				FS.chdir(`${aioli.config.dirShared}${aioli.config.dirData}`);
			}
		}

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
		const dirMounted = aioli.config.dirMounted;
		const dirData = aioli.config.dirData;

		// Input validation. Note that FileList is not an array so we can't use Array.isArray() but it does have a
		// length attribute. So do strings, which is why we explicitly check for those.
		let toMountFiles = [], toSymlink = [], mountPaths = [];
		if(!files?.length || typeof files === "string")
			files = [ files ];

		// Sort files by type: File vs. Blob vs. URL
		for(let file of files)
		{
			// Handle File/Blob objects
			// Blob formats: { name: "filename.txt", data: new Blob(['blob data']) }
			if(file instanceof File || (file?.data instanceof Blob && file.name))
			{
				toMountFiles.push(file);

				// Track paths
				const paths = {
					oldpath: `${dirMounted}/${file.name}`,
					newpath: `${dirData}/${file.name}`
				};
				toSymlink.push(paths);
				mountPaths.push(paths.newpath);

			// Handle URLs: mount "https://website.com/some/path.js" to "/urls/website.com-some-path.js")
			} else if(typeof file == "string" && file.startsWith("http")) {
				const fileName = file.split("//").pop().replace(/\//g, "-");
				aioli.fs.createLazyFile(dirData, fileName, file, true, true);
				mountPaths.push(`${dirData}/${fileName}`);

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
		aioli.files = aioli.files.concat(toMountFiles);
		aioli.fs.mount(aioli.tools[0].module.WORKERFS, {
			files: aioli.files.filter(f => f instanceof File),
			blobs: aioli.files.filter(f => f?.data instanceof Blob)
		}, dirMounted);

		// Create symlinks for convenience
		toSymlink.map(d => {
			try {
				aioli.fs.unlink(d.newpath);
			} catch(e) {}
			aioli.fs.symlink(d.oldpath, d.newpath);
		})

		return mountPaths;
	},

	// =========================================================================
	// Execute a command
	// =========================================================================
	async exec(command)
	{
		// Input validation
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
	}
};

Comlink.expose(aioli);
