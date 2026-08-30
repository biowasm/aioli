// =============================================================================
// OPFSFS — a custom Emscripten (legacy) filesystem backed by OPFS sync handles.
//
// This is the "PROXYFS alternative": instead of bulk-copying the whole session
// OPFS <-> MEMFS on every command, existing files are read/written DIRECTLY via
// FileSystemSyncAccessHandle. Only the bytes a tool actually touches move.
//
//   - Existing session files  -> backed by an OPFS sync handle (direct r/w).
//   - New files created mid-run -> buffered in memory, flushed to OPFS after.
//     (open() is synchronous but createSyncAccessHandle() is async, so a handle
//      can't be acquired lazily inside open(); new files defer to flush().)
//
// Works in a plain dedicated worker with crossOriginIsolated === false.
// Modeled on Emscripten's libworkerfs.js contract.
// =============================================================================

const ENOENT = 44, EEXIST = 20, EPERM = 63, EINVAL = 28, ENOTEMPTY = 55;
const S_IFREG = 32768, S_IFDIR = 16384, S_IFLNK = 40960;
const SEEK_CUR = 1, SEEK_END = 2;

// Async: open the session dir and pre-acquire sync handles for existing files.
// This is O(number of files) — it opens handles, it does NOT copy file data.
export async function prepareOPFS(sessionDir) {
	const root = await navigator.storage.getDirectory();
	const dir = await root.getDirectoryHandle(sessionDir, { create: true });
	const entries = [];
	for await (const [name, h] of dir.entries()) {
		if (h.kind !== "file") continue;
		const handle = await acquire(h);
		entries.push({ name, handle, size: handle.getSize() });
	}
	return { dir, entries };
}

// Acquire a sync access handle in "readwrite-unsafe" mode. This is essential for
// the disposable-worker + cancellation model: the default mode takes an EXCLUSIVE
// lock, and a worker terminated mid-run (a cancel) does NOT promptly release its
// handles — so the next command would be blocked (NoModificationAllowedError,
// held until GC). "readwrite-unsafe" drops the exclusive lock so a leaked handle
// can't block the next worker. Safe here because execution is strictly sequential
// (never two live workers writing the same file at once).
async function acquire(fileHandle, tries = 5) {
	for (let i = 0; ; i++) {
		try { return await fileHandle.createSyncAccessHandle({ mode: "readwrite-unsafe" }); }
		catch (e) {
			if (i >= tries) throw e;
			await new Promise((r) => setTimeout(r, 25));
		}
	}
}

// Build the FS object to hand to FS.mount(), plus an async flush() to persist
// new/changed files back to OPFS and release all handles.
export function createOPFSFS(FS, prepared) {
	const nodes = [];        // every file node we create (for flush)
	const deletions = new Set();
	// Instrumentation to demonstrate "no bulk copy": bytes moved via sync handles
	// vs. the total size of existing files (which a copy-based FS would move wholesale).
	const stats = {
		existingFiles: prepared.entries.length,
		existingBytes: prepared.entries.reduce((s, e) => s + e.size, 0),
		handleReadBytes: 0, handleWriteBytes: 0, newFileBytesFlushed: 0,
	};

	function track(node) { if (FS.isFile(node.mode)) nodes.push(node); return node; }

	const OPFSFS = {
		mount() {
			const root = OPFSFS.createNode(null, "/", S_IFDIR | 0o777, 0);
			// existing OPFS files -> nodes with pre-opened handles (no data copied)
			for (const e of prepared.entries) {
				const node = OPFSFS.createNode(root, e.name, S_IFREG | 0o666, 0);
				node.handle = e.handle;
				node.size = e.size;
			}
			return root;
		},

		createNode(parent, name, mode, dev) {
			const node = FS.createNode(parent, name, mode, dev);
			node.node_ops = OPFSFS.node_ops;
			node.stream_ops = OPFSFS.stream_ops;
			node.handle = null;      // OPFS sync handle (existing files)
			node.contents = null;    // in-memory buffer (new files)
			node.capacity = 0;
			node.size = 0;
			node.dirty = false;      // memory-backed & needs flush
			node.link = null;        // symlink target
			node.atime = node.mtime = node.ctime = Date.now();
			if (FS.isDir(mode)) node.contents = {};
			if (parent) parent.contents[name] = node;
			return track(node);
		},

		node_ops: {
			getattr(node) {
				const size = node.handle ? node.handle.getSize() : node.size;
				return {
					dev: 1, ino: node.id, mode: node.mode, nlink: 1, uid: 0, gid: 0, rdev: 0,
					size, atime: new Date(node.atime), mtime: new Date(node.mtime),
					ctime: new Date(node.ctime), blksize: 4096, blocks: Math.ceil(size / 4096),
				};
			},
			setattr(node, attr) {
				if (attr.mode != null) node.mode = attr.mode;
				if (attr.atime != null) node.atime = new Date(attr.atime).getTime();
				if (attr.mtime != null) node.mtime = new Date(attr.mtime).getTime();
				if (attr.size != null) truncate(node, attr.size);
			},
			lookup(parent, name) {
				const node = parent.contents[name];
				if (!node) throw new FS.ErrnoError(ENOENT);
				return node;
			},
			mknod(parent, name, mode, dev) {
				const node = OPFSFS.createNode(parent, name, mode, dev);
				if (FS.isFile(mode)) { node.contents = new Uint8Array(0); node.dirty = true; }
				return node;
			},
			rename(oldNode, newDir, newName) {
				// If moving an OPFS-backed file, materialize it to memory so flush
				// writes it under the new name (OPFS has no atomic rename).
				if (oldNode.handle && FS.isFile(oldNode.mode)) materialize(oldNode);
				delete oldNode.parent.contents[oldNode.name];
				if (oldNode.name !== newName || oldNode.parent !== newDir) {
					if (FS.isFile(oldNode.mode)) { oldNode.dirty = true; deletions.add(oldNode.name); }
				}
				oldNode.name = newName;
				oldNode.parent = newDir;
				newDir.contents[newName] = oldNode;
			},
			unlink(parent, name) {
				const node = parent.contents[name];
				if (!node) throw new FS.ErrnoError(ENOENT);
				if (node.handle) { try { node.handle.close(); } catch {} node.handle = null; }
				node.deleted = true;
				deletions.add(name);
				delete parent.contents[name];
			},
			rmdir(parent, name) {
				const node = parent.contents[name];
				if (!node) throw new FS.ErrnoError(ENOENT);
				if (Object.keys(node.contents).length) throw new FS.ErrnoError(ENOTEMPTY);
				delete parent.contents[name];
			},
			readdir(node) {
				return [".", "..", ...Object.keys(node.contents)];
			},
			symlink(parent, newName, oldPath) {
				const node = OPFSFS.createNode(parent, newName, S_IFLNK | 0o777, 0);
				node.link = oldPath;
				return node;
			},
			readlink(node) {
				if (!FS.isLink(node.mode)) throw new FS.ErrnoError(EINVAL);
				return node.link;
			},
		},

		stream_ops: {
			open() {},
			close() {},
			read(stream, buffer, offset, length, position) {
				const node = stream.node;
				if (node.handle) {
					const size = node.handle.getSize();
					if (position >= size) return 0;
					const toRead = Math.min(length, size - position);
					// read straight into the wasm heap view — no intermediate copy
					const n = node.handle.read(buffer.subarray(offset, offset + toRead), { at: position });
					stats.handleReadBytes += n;
					return n;
				}
				if (position >= node.size) return 0;
				const toRead = Math.min(node.size - position, length);
				buffer.set(node.contents.subarray(position, position + toRead), offset);
				return toRead;
			},
			write(stream, buffer, offset, length, position) {
				const node = stream.node;
				node.mtime = Date.now();
				if (node.handle) {
					const n = node.handle.write(buffer.subarray(offset, offset + length), { at: position });
					node.size = node.handle.getSize();
					stats.handleWriteBytes += n;
					return n;
				}
				if (!length) return 0;
				ensure(node, position + length);
				node.contents.set(buffer.subarray(offset, offset + length), position);
				node.size = Math.max(node.size, position + length);
				node.dirty = true;
				return length;
			},
			llseek(stream, offset, whence) {
				let position = offset;
				if (whence === SEEK_CUR) position += stream.position;
				else if (whence === SEEK_END) position += (stream.node.handle ? stream.node.handle.getSize() : stream.node.size);
				if (position < 0) throw new FS.ErrnoError(EINVAL);
				return position;
			},
		},
	};

	function ensure(node, need) {
		if (node.contents && node.capacity >= need) return;
		const newCap = Math.max(need, (node.capacity || 0) * 2, 256);
		const nc = new Uint8Array(newCap);
		if (node.contents) nc.set(node.contents.subarray(0, node.size));
		node.contents = nc;
		node.capacity = newCap;
	}
	function materialize(node) {
		const size = node.handle.getSize();
		const buf = new Uint8Array(size);
		node.handle.read(buf, { at: 0 });
		try { node.handle.close(); } catch {}
		node.handle = null;
		node.contents = buf; node.capacity = size; node.size = size; node.dirty = true;
	}
	function truncate(node, size) {
		if (node.handle) { node.handle.truncate(size); node.size = size; return; }
		ensure(node, size);
		if (size < node.size) node.contents.fill(0, size);
		node.size = size; node.dirty = true;
	}

	// Persist changes and release all handles. Call after callMain (async).
	async function flush() {
		for (const name of deletions) {
			try { await prepared.dir.removeEntry(name); } catch {}
		}
		for (const node of nodes) {
			if (node.deleted || !FS.isFile(node.mode)) continue;
			if (node.handle) {
				try { node.handle.flush(); node.handle.close(); } catch {}
				node.handle = null;
			} else if (node.dirty && node.contents) {
				const fh = await prepared.dir.getFileHandle(node.name, { create: true });
				const h = await acquire(fh);
				h.truncate(0);
				h.write(node.contents.subarray(0, node.size), { at: 0 });
				h.flush(); h.close();
				stats.newFileBytesFlushed += node.size;
				node.dirty = false;
			}
		}
	}

	// Safety net if a run is abandoned: release handles without persisting.
	function closeAll() {
		for (const node of nodes) if (node.handle) { try { node.handle.close(); } catch {} node.handle = null; }
	}

	return { fs: OPFSFS, flush, closeAll, stats };
}

