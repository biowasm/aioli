import * as Comlink from "comlink";
import { simd, threads } from "wasm-feature-detect";

const aioli = {
	// Configuration
	tools: [],
	config: {},

	// =========================================================================
	// Initialize the WebAssembly module(s)
	// =========================================================================
	async init()
	{
		// Load each tool
		for(let tool of aioli.tools)
		{
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
		}

		// console.log(aioli.tools[0].module.FS.readdir("/"));
		// console.log(aioli.config)
		// console.log(`aioli v${pkg.version}`)
		return 345;
	},

	// =========================================================================
	// Mount files to the virtual file system
	// =========================================================================
	// TODO:
	mount(files) {
		console.log("mount")
		console.log(files[0].name)
		console.log(files[0].size)
		return 123
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

		// TODO:
		// Re-open stdout/stderr (fix error "error closing standard output: -1")
		tool.module.FS.streams[1] = tool.module.FS.open("/dev/stdout", "w");
		tool.module.FS.streams[2] = tool.module.FS.open("/dev/stderr", "w");

		return {
			stdout: tool.stdout,
			stderr: tool.stderr
		}
	},
	//
	// TODO: ls, cat, download
};

Comlink.expose(aioli);
