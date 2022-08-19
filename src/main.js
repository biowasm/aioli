import { wrap } from "comlink";
import AioliWorker from "./worker?worker&inline";

// Constants
const URL_CDN_ROOT = "https://biowasm.com/cdn/v3";
const URL_CDN_ROOT_STG = "https://stg.biowasm.com/cdn/v3";
const CONFIG_DEFAULTS = {
	// Biowasm CDN URLs
	urlCDN: URL_CDN_ROOT,
	urlCDNStg: URL_CDN_ROOT_STG,

	// Folder to use for mounting the shared filesystem
	dirShared: "/shared",
	// Folder to use for mounting File/Blob objects to the virtual file system
	dirMounted: "/mnt",
	// Folder to use for symlinks (basically, we make a symlink to each file mounted on WORKERFS
	// so that operations like "samtools index" don't crash due to the read-only nature of WORKERS).
	// Also mount URLs lazily in that folder.
	dirData: "/data",
	// Interleave stdout/stderr. If set to false, `.exec()` returns an object { "stdout": <text>, "stderr": <text> }
	printInterleaved: true,

	// Callback function to run whenever we receive a message from the WebWorker with payload { type: "biowasm", value: ... }.
	// See <https://github.com/biowasm/biowasm/tree/main/tools/bhtsne> for an example of how this can be used to send regular updates
	// back to the main thread before callMain() is done running.
	callback: null,

	// Debugging
	debug: false,
	env: "prd"
};

// Class: 1 object = 1 worker; user can decide if they want tools running in separate threads or all of them in one
export default class Aioli {
	constructor(tools, config={}) {
		if(tools == null)
			throw "Expecting array of tools as input to Aioli constructor.";

		// Parse user input
		if(!Array.isArray(tools))
			tools = [ tools ];
		// Overwrite default config if specified
		config = Object.assign({}, CONFIG_DEFAULTS, config);
		// For convenience, support "<tool>/<version>" or "<tool>/<program>/<version>" instead of object config
		tools = tools.map(this._parseTool);
		// If testing with different environment e.g. stg.biowasm.com
		if(config.env === "stg")
			config.urlCDN = config.urlCDNStg;

		// Set state
		this.tools = tools;
		this.config = config;

		// Handle callback (delete it because we can't send a function to the WebWorker)
		if(this.config.callback != null)
			this.callback = this.config.callback;
		delete this.config.callback;

		return this.init();
	}

	// Initialize the WebWorker and the WebAssembly modules within it
	async init() {
		// Create the WebWorker
		const worker = new AioliWorker();

		// Listen for "biowasm" messages from the WebWorker
		if(this.callback)
			worker.onmessage = e => {
				if(e.data.type === "biowasm")
					this.callback(e.data.value);
			}

		const aioli = wrap(worker);
		aioli.tools = this.tools;
		aioli.config = this.config;

		// Initialize the tools inside the WebWorker
		await aioli.init();

		return aioli;
	}

	// Parse "<tool>/<version>" and "<tool>/<program>/<version>" into { "tool": <tool>, "program": <program>, "version": <version> }
	_parseTool(tool) {
		// If not a string, leave it as is
		if(typeof tool !== "string")
			return tool;

		// Support "<tool>/<version>" and "<tool>/<program>/<version>"
		const toolSplit = tool.split("/");
		if(toolSplit.length != 2 && toolSplit.length != 3)
			throw "Expecting '<tool>/<version>' or '<tool>/<program>/<version>'";

		return {
			tool: toolSplit[0],
			program: toolSplit.length == 3 ? toolSplit[1] : toolSplit[0],
			version: toolSplit[toolSplit.length - 1]
		};
	}
}
