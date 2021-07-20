import pkg from "../package.json";
import * as Comlink from "comlink";

// Constants
const URL_CDN_ROOT = "https://cdn.biowasm.com/v2";
const CONFIG_DEFAULTS = {
	// Biowasm CDN URLs
	urlCDN: URL_CDN_ROOT,
	// Get the Worker code corresponding to the current Aioli version
	urlAioli: `${URL_CDN_ROOT}/aioli/${pkg.version}/aioli.worker.js`,
	// Various folder paths use in the virtual file system
	// Folder to use for mounting the shared filesystem
	dirShared: "/shared",
	// Folder to use for mounting File/Blob objects to the virtual file system
	dirMounted: "/mnt",
	// Folder to use for mounting URLs lazily
	dirURLs: "/urls",
};

// Class: 1 object = 1 worker; user can decide if they want tools running in separate threads or all of them in one
export default class Aioli
{
	constructor(tools, config={})
	{
		// Input validation
		if(tools == null)
			throw "Expecting array of tools as input to Aioli constructor.";
		if(!Array.isArray(tools))
			tools = [ tools ];

		// Overwrite default config if specified
		config = Object.assign({}, CONFIG_DEFAULTS, config);

		// Create the WebWorker
		const worker = new Worker(config.urlAioli);
		const aioli = Comlink.wrap(worker);

		// Update configuration
		aioli.tools = tools;
		aioli.config = config;

		return aioli;
	}
}
