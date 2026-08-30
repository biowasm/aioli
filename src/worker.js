// =============================================================================
// Aioli v4 — disposable per-execution worker.
//
// Spawned fresh for ONE command and terminated afterward (so cancellation is
// just worker.terminate()). Filesystem:
//   - /shared/data is an OPFSFS mount: existing session files are read/written
//     directly via OPFS sync handles (no bulk copy); new files buffer + flush.
//     (Path matches Aioli v3's shared working dir for backwards-compat.)
//   - Local File/Blob inputs mount ZERO-COPY via WORKERFS at /mnt; remote {name,url}
//     inputs mount LAZILY (byte-range XHR) via createLazyFile — both symlinked into
//     /shared/data.
// Runs with crossOriginIsolated === false (no COOP/COEP).
// =============================================================================

import { prepareOPFS, createOPFSFS } from "./opfs-fs.js";

self.onmessage = async (e) => {
	try {
		const result = await runCommand(e.data);
		self.postMessage({ type: "result", ok: true, ...result });
	} catch (err) {
		self.postMessage({ type: "result", ok: false, error: String((err && err.stack) || err) });
	}
};

async function runCommand({ tool, args, userFiles, sessionDir, cwd, stdin, printInterleaved }) {
	// -- Load the Emscripten module (ES6: dynamic import, no globals) ----------
	const { default: Module } = await import(/* @vite-ignore */ tool.mjsUrl);
	let stdout = "";
	let stderr = "";
	let stdinPos = 0;

	const module = await Module({
		thisProgram: tool.program || tool.tool,
		locateFile: (path) => `${tool.baseUrl}/${path}`,
		stdin: () => {
			if (stdin != null && stdinPos < stdin.length) return stdin.charCodeAt(stdinPos++);
			return null;
		},
		print: (t) => { stdout += t + "\n"; },
		printErr: printInterleaved ? (t) => { stdout += t + "\n"; } : (t) => { stderr += t + "\n"; },
	});
	const FS = module.FS;

	// -- Mount OPFSFS at /shared/data (direct sync-handle I/O; no bulk copy) ---
	// Path kept as /shared/data (not /data) for backwards-compat with Aioli v3,
	// whose shared working dir was dirShared("/shared") + dirData("/data").
	const prepared = await prepareOPFS(sessionDir);
	const opfs = createOPFSFS(FS, prepared);
	FS.mkdirTree("/shared/data");
	FS.mount(opfs.fs, {}, "/shared/data");

	// -- Mount user inputs, symlinked into the working dir ---------------------
	if (userFiles && userFiles.length) {
		const blobFiles = userFiles.filter((f) => f instanceof File || (f && f.data instanceof Blob));
		const urlFiles  = userFiles.filter((f) => f && typeof f.url === "string");

		// Local File/Blob inputs: ZERO-COPY via WORKERFS at /mnt
		if (blobFiles.length) {
			FS.mkdir("/mnt");
			FS.mount(module.WORKERFS, {
				files: blobFiles.filter((f) => f instanceof File),
				blobs: blobFiles.filter((f) => f && f.data instanceof Blob),
			}, "/mnt");
			for (const f of blobFiles) {
				try { FS.symlink(`/mnt/${f.name}`, `/shared/data/${f.name}`); } catch {}
			}
		}

		// Remote URL inputs: LAZY byte-range XHR (no full download) via createLazyFile,
		// kept in a MEMFS dir and symlinked into the working dir. The server must support
		// range requests + CORS. Sync XHR is allowed in workers, so this works with
		// crossOriginIsolated === false (no COOP/COEP).
		if (urlFiles.length) {
			if (typeof FS.createLazyFile !== "function")
				throw "This tool build does not support URL mounts (FS.createLazyFile unavailable).";
			FS.mkdir("/urls");
			for (const f of urlFiles) {
				FS.createLazyFile("/urls", f.name, f.url, true, false);
				try { FS.symlink(`/urls/${f.name}`, `/shared/data/${f.name}`); } catch {}
			}
		}
	}

	FS.chdir(cwd && FS.analyzePath(cwd).exists ? cwd : "/shared/data");

	// -- Run (synchronous) -----------------------------------------------------
	let exitCode = 0;
	try {
		module.callMain(args);
	} catch (err) {
		if (err && typeof err.status === "number") exitCode = err.status;
		else stderr += `\n[aioli] ${err}\n`;
	}

	// -- Persist new/changed files to OPFS; release handles --------------------
	await opfs.flush();

	const files = await listSession(prepared.dir);
	return { stdout, stderr, exitCode, files, stats: opfs.stats, cwd: FS.cwd() };
}

async function listSession(dir) {
	const out = [];
	for await (const [name, handle] of dir.entries()) {
		if (handle.kind !== "file") continue;
		out.push({ name, size: (await handle.getFile()).size });
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}
