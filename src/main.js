import pkg from "../package.json";
import * as Comlink from "comlink";
import { simd, threads } from "wasm-feature-detect";

// Constants
const URL_CDN_ROOT = "https://cdn.biowasm.com/v2";
const configDefault = {
	urlRoot: URL_CDN_ROOT,
	urlAioli: `${URL_CDN_ROOT}/aioli/${pkg.version}.aioli.worker.js`
}

// Class: 1 object = 1 worker; user can decide if they want tools running in separate threads or all of them in one
export default class Aioli
{
	constructor(tools, config=configDefault)
	{
		// Input validation
		if(tools == null)
			throw "Expecting array of tools as input to Aioli constructor.";
		if(!Array.isArray(tools))
			tools = [ tools ];

		// Create the WebWorker
		const worker = new Worker("./dist/aioli.worker.js");
		const aioli = Comlink.wrap(worker);

		// Update configuration
		aioli.tools = tools;
		Object.assign(aioli.config, config);

		return aioli;
	}
}
