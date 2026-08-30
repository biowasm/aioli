import { simd } from "wasm-feature-detect";
import AioliWorker from "./worker?worker&inline";

// Biowasm CDN
const URL_CDN_ROOT = "https://biowasm-v3-stg.robert.workers.dev/cdn/v3";
const URL_CDN_ROOT_STG = "https://biowasm-v3-stg.robert.workers.dev/cdn/v3";

// Tools whose CDN build ships a SIMD variant (loaded as "<program>-simd" when supported)
const WASM_FEATURES = {
	ssw: ["simd"],
	minimap2: ["simd"],
};

const CONFIG_DEFAULTS = {
	urlCDN: URL_CDN_ROOT,
	urlCDNStg: URL_CDN_ROOT_STG,
	// Name of the OPFS directory that holds this session's shared/persistent filesystem
	sessionDir: "aioli",
	// Interleave stdout/stderr into a single string (else exec() returns { stdout, stderr })
	printInterleaved: true,
	// Called with the payload of any { type: "biowasm", value } message a tool posts mid-run
	callback: null,
	debug: false,
	env: "prd",
};

// =============================================================================
// Aioli v4 — main-thread orchestrator.
//
// One DISPOSABLE Web Worker per exec() => cancellation is worker.terminate().
// User files are retained here and mounted zero-copy (WORKERFS) in each worker.
// The shared/persistent filesystem lives in OPFS (async at boundaries; sync
// access handles inside the worker). No PROXYFS, no base module, no COOP/COEP.
// =============================================================================
export default class Aioli {
	constructor(tools, config = {}) {
		if (tools == null) throw "Expecting array of tools as input to Aioli constructor.";
		if (!Array.isArray(tools)) tools = [tools];
		config = Object.assign({}, CONFIG_DEFAULTS, config);
		if (config.env === "stg") config.urlCDN = config.urlCDNStg;

		this.config = config;
		this.callback = config.callback || null;
		// v3 back-compat: the "base" module is obsolete in v4 (no shared base FS). Ignore it
		// with a warning instead of trying to load it, so v3 tool lists keep working.
		this._rawTools = tools.map(this._parseTool).filter(t => {
			if (t.tool === "base") {
				console.warn("[Aioli] The 'base' module is no longer needed in Aioli v4 — ignoring it.");
				return false;
			}
			return true;
		});

		// Session state
		this.userFiles = [];   // File/Blob objects, retained across execs (zero-copy)
		this.cwd = "/shared/data";  // matches Aioli v3's shared working dir (dirShared + dirData)
		this._stdin = "";
		this._worker = null;
		this._running = false;
		this._reject = null;

		return this.init();
	}

	async init() {
		// Resolve each tool's URLs + SIMD variant. No worker is spawned until exec().
		this.tools = [];
		for (const t of this._rawTools) {
			let program = t.program || t.tool;
			const features = {};
			if ((WASM_FEATURES[program] || []).includes("simd") && (await simd())) {
				program += "-simd";
				features.simd = true;
			}
			const baseUrl = t.urlPrefix || `${this.config.urlCDN}/${t.tool}/${t.version}`;
			this.tools.push({ ...t, program, features, baseUrl, mjsUrl: `${baseUrl}/${program}.mjs`, ready: true });
		}
		this._log(`Ready with ${this.tools.length} tool(s).`);
		return this;
	}

	_parseTool(tool) {
		if (typeof tool !== "string") return tool;
		const s = tool.split("/");
		if (s.length != 2 && s.length != 3) throw "Expecting '<tool>/<version>' or '<tool>/<program>/<version>'";
		return { tool: s[0], program: s.length == 3 ? s[1] : s[0], version: s[s.length - 1] };
	}

	// ---- mounting -----------------------------------------------------------
	// Retain inputs; they are mounted per exec (local File/Blob zero-copy via WORKERFS,
	// remote { name, url } lazily via byte-range XHR). Cheap to "re-mount" after a cancel
	// (we just re-hand the same objects to the worker).
	mount(files = []) {
		if (!Array.isArray(files) && !(files instanceof FileList)) files = [files];
		const mounted = [];
		for (let f of files) {
			// Remote URL input: retain { name, url } as-is; fetched lazily in the worker.
			if (f && typeof f.url === "string") {
				if (!f.name) throw "URL mounts require a name: { name, url }";
				this.userFiles.push({ name: f.name, url: f.url });
				mounted.push(`${this.cwd}/${f.name}`);
				continue;
			}
			if (typeof f?.data === "string") f = { name: f.name, data: new Blob([f.data]) };
			if (!(f instanceof File) && !(f?.data instanceof Blob))
				throw "mount() expects File, Blob, { name, data }, or { name, url } objects.";
			this.userFiles.push(f);
			mounted.push(`${this.cwd}/${f.name}`);
		}
		this._log(`Mounted ${files.length} file(s).`);
		return mounted;
	}

	// ---- execution ----------------------------------------------------------
	exec(command, args = null) {
		if (!command) return Promise.reject(new Error("Expecting a command"));
		if (args == null) { args = command.trim().split(/\s+/); command = args.shift(); }
		const tool = this.tools.find((t) => t.program === command || t.program === `${command}-simd` || t.tool === command);
		if (!tool) return Promise.reject(new Error(`Program ${command} not found.`));

		const worker = new AioliWorker();
		this._worker = worker;
		this._running = true;
		this._log(`exec: ${command} ${args.join(" ")}`);

		return new Promise((resolve, reject) => {
			this._reject = reject;
			worker.onmessage = (e) => {
				const d = e.data;
				if (d.type === "biowasm") { if (this.callback) this.callback(d.value); return; }
				// final result
				this._running = false;
				worker.terminate();
				this._worker = null;
				this._reject = null;
				this._stdin = "";
				if (!d.ok) return reject(new Error(d.error));
				if (d.cwd) this.cwd = d.cwd;
				resolve(this.config.printInterleaved ? d.stdout : { stdout: d.stdout, stderr: d.stderr });
			};
			worker.onerror = (err) => {
				this._running = false; this._worker = null; this._reject = null;
				reject(new Error(err.message || "worker error"));
			};
			worker.postMessage({
				tool: { tool: tool.tool, program: tool.program, baseUrl: tool.baseUrl, mjsUrl: tool.mjsUrl },
				args,
				userFiles: this.userFiles,
				sessionDir: this.config.sessionDir,
				cwd: this.cwd,
				stdin: this._stdin,
				printInterleaved: this.config.printInterleaved,
			});
		});
	}

	// Hard-cancel the in-flight command. A synchronous callMain() can't be
	// interrupted cooperatively, so we terminate the worker; the OPFS session FS
	// and retained user files survive, so nothing needs remounting.
	cancel() {
		if (this._worker && this._running) {
			this._worker.terminate();
			this._worker = null;
			this._running = false;
			if (this._reject) { this._reject(new Error("cancelled")); this._reject = null; }
			this._log("cancelled (worker terminated; OPFS session intact)");
			return true;
		}
		return false;
	}

	get running() { return this._running; }

	// ---- stdin --------------------------------------------------------------
	get stdin() { return this._stdin; }
	set stdin(txt = "") { this._stdin = txt; }

	// ---- filesystem helpers (async OPFS on the main thread) -----------------
	async _dir() {
		const root = await navigator.storage.getDirectory();
		return root.getDirectoryHandle(this.config.sessionDir, { create: true });
	}

	async ls() {
		const dir = await this._dir();
		const out = [];
		for await (const [name, h] of dir.entries()) if (h.kind === "file") out.push({ name, size: (await h.getFile()).size });
		return out.sort((a, b) => a.name.localeCompare(b.name));
	}

	async cat(name) {
		const dir = await this._dir();
		return (await (await dir.getFileHandle(name)).getFile()).text();
	}

	async download(name) {
		const dir = await this._dir();
		const blob = await (await dir.getFileHandle(name)).getFile();
		return URL.createObjectURL(blob);
	}

	pwd() { return this.cwd; }
	cd(path) { this.cwd = path; return true; }
	mkdir() { return true; } // OPFS session is flat in v4; dirs are created on demand by tools

	async reset() {
		const root = await navigator.storage.getDirectory();
		try { await root.removeEntry(this.config.sessionDir, { recursive: true }); } catch {}
		this.userFiles = [];
		this.cwd = "/shared/data";
	}

	_log(msg) { if (this.config.debug) console.log(`%c[Aioli]%c ${msg}`, "font-weight:bold", ""); }
}
