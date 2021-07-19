import * as Comlink from "comlink";

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
			// Unless specified, we want to use the latest version of a tool
			if(!tool.version)
				tool.version = "latest";

			// In most cases, the program is the same as the module, but there are exceptions. For example, for the
			// module "seq-align", program can be "needleman_wunsch", "smith_waterman", or "lcs".
			if(!tool.program)
				tool.program = tool.module;

			// By default, use the CDN path, but also accept custom paths for each tool
			if(!tool.urlPrefix)
				tool.urlPrefix = `${aioli.config.urlCDN}/${tool.module}/${tool.version}`;

			// -----------------------------------------------------------------
			// Import the WebAssembly module
			// -----------------------------------------------------------------
			// All biowasm modules export the variable "Module" so assign it
			self.importScripts(`${tool.urlPrefix}/${tool.program}.js`);
			tool.module = await Module({
				locateFile: (path, prefix) => `${tool.urlPrefix}/${path}`
			});
		}

		console.log(aioli.tools);
		console.log(aioli.tools[0].module.FS.readdir("/"));
		// console.log(aioli.config)
		// console.log(`aioli v${pkg.version}`)
		return 345;
	},

	//
	mount(files) {
		console.log("mount")
		console.log(files[0].name)
		console.log(files[0].size)
		return 123
	},
	set(tools) {

	},
};

Comlink.expose(aioli);
