import { simd, threads } from "wasm-feature-detect";
import * as Comlink from "comlink";

export default class Aioli
{
	constructor(config)
	{
		//
	}

	async init()
	{
		const worker = new Worker("./dist/aioli.worker.js");
		const obj = Comlink.wrap(worker);
		return obj;
	}
}
