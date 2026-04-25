importScripts("./scram/scramjet.all.js?v=6");
if (!self.Ultraviolet) {
	importScripts("./uv/uv.bundle.js?v=6");
}
if (!self.__uv$config) {
	importScripts("./uv/uv.config.js?v=6");
}
if (!self.UVServiceWorker) {
	importScripts("./uv/uv.sw.js?v=6");
}

// trying to hard block the new adblock.turtlecute.org scripts (fakeads)
const { ScramjetServiceWorker } = $scramjetLoadWorker();
const uvServiceWorker = new UVServiceWorker();
let scramjet = null;
let scramjetCircuitOpen = false;
const scramjetReadyPromise = initializeScramjetServiceWorker();

const hardBlockedAdKeywords = [
	"adblock.turtlecute.org/js/pagead.js",
	"adblock.turtlecute.org/js/widget/ads.js",
	"https%3a%2f%2fadblock.turtlecute.org%2fjs%2fpagead.js",
	"https%3a%2f%2fadblock.turtlecute.org%2fjs%2fwidget%2fads.js",
];

self.addEventListener("install", () => {
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		Promise.all([
			self.clients.claim(),
			scramjetReadyPromise.catch((error) => {
				console.warn("[frosted-sw] scramjet startup recovery failed:", error);
			}),
		])
	);
});

self.addEventListener("message", (event) => {
	if (event?.data?.type === "SKIP_WAITING") {
		self.skipWaiting();
	}
});

function matchesHardBlockedKeyword(rawValue) {
	const source = String(rawValue || "").trim();
	if (!source) return false;
	const variants = [source.toLowerCase()];
	try {
		const once = decodeURIComponent(source);
		variants.push(String(once || "").toLowerCase());
		try {
			const twice = decodeURIComponent(once);
			variants.push(String(twice || "").toLowerCase());
		} catch {}
	} catch {}
	return variants.some((value) =>
		hardBlockedAdKeywords.some((keyword) => value.includes(keyword))
	);
}

function isHardBlockedAdRequest(request) {
	try {
		const rawUrl = String(request?.url || "");
		if (matchesHardBlockedKeyword(rawUrl)) return true;
		const parsed = new URL(rawUrl);
		if (matchesHardBlockedKeyword(parsed.href)) return true;
		if (matchesHardBlockedKeyword(parsed.pathname)) return true;
		if (matchesHardBlockedKeyword(parsed.search)) return true;
	} catch {}
	return false;
}

function shouldBypassScramjet(request) {
	try {
		const url = new URL(request.url);
		const path = url.pathname.toLowerCase();

		// Common OpenAI-compatible API paths used by chat/model/tts flows.
		if (
			path.startsWith("/v1/chat/completions") ||
			path.startsWith("/v1/models") ||
			path.startsWith("/v1/responses") ||
			path.startsWith("/v1/audio/speech")
		) {
			return true;
		}
	} catch {
		// no-op; default routing will be used.
	}
	return false;
}

function getAppBasePath() {
	try {
		var path = String(self.location.pathname || "/").replace(/\/[^/]*$/, "/");
		if (!path.startsWith("/")) path = `/${path}`;
		return path.replace(/\/{2,}/g, "/");
	} catch {
		return "/";
	}
}

function getScramjetPrefixPath() {
	return `${getAppBasePath()}scramjet/`.replace(/\/{2,}/g, "/");
}

function getDefaultScramjetConfig() {
	const appBasePath = getAppBasePath();
	return {
		prefix: getScramjetPrefixPath(),
		globals: {
			wrapfn: "$scramjet$wrap",
			wrappropertybase: "$scramjet__",
			wrappropertyfn: "$scramjet$prop",
			cleanrestfn: "$scramjet$clean",
			importfn: "$scramjet$import",
			rewritefn: "$scramjet$rewrite",
			metafn: "$scramjet$meta",
			setrealmfn: "$scramjet$setrealm",
			pushsourcemapfn: "$scramjet$pushsourcemap",
			trysetfn: "$scramjet$tryset",
			templocid: "$scramjet$temploc",
			tempunusedid: "$scramjet$tempunused",
		},
		files: {
			wasm: `${appBasePath}scram/scramjet.wasm.wasm`,
			all: `${appBasePath}scram/scramjet.all.js`,
			sync: `${appBasePath}scram/scramjet.sync.js`,
		},
		flags: {
			serviceworkers: false,
			syncxhr: false,
			strictRewrites: true,
			rewriterLogs: false,
			captureErrors: true,
			cleanErrors: false,
			scramitize: false,
			sourcemaps: true,
			destructureRewrites: false,
			interceptDownloads: false,
			allowInvalidJs: true,
			allowFailedIntercepts: true,
		},
		siteFlags: {},
		codec: {
			encode: (value) => (value ? encodeURIComponent(value) : value),
			decode: (value) => (value ? decodeURIComponent(value) : value),
		},
	};
}

function getPersistableScramjetConfig(config) {
	return {
		prefix: config.prefix,
		globals: { ...(config.globals || {}) },
		files: { ...(config.files || {}) },
		flags: { ...(config.flags || {}) },
		siteFlags: { ...(config.siteFlags || {}) },
	};
}

function normalizeScramjetConfig(config) {
	const defaults = getDefaultScramjetConfig();
	const candidate = config && typeof config === "object" ? config : {};
	return {
		...defaults,
		...candidate,
		globals: { ...defaults.globals, ...(candidate.globals || {}) },
		files: { ...defaults.files, ...(candidate.files || {}) },
		flags: { ...defaults.flags, ...(candidate.flags || {}) },
		siteFlags: { ...defaults.siteFlags, ...(candidate.siteFlags || {}) },
		codec: defaults.codec,
	};
}

function isUvRequest(requestUrl) {
	try {
		var url = new URL(requestUrl);
		return url.origin === location.origin && url.pathname.startsWith(self.__uv$config.prefix);
	} catch {
		return false;
	}
}

function isScramjetRequest(requestUrl) {
	try {
		var url = new URL(requestUrl);
		return url.origin === location.origin && url.pathname.startsWith(getScramjetPrefixPath());
	} catch {
		return false;
	}
}

function isScramjetWasmRequest(requestUrl) {
	try {
		var url = new URL(requestUrl);
		return url.origin === location.origin && url.pathname === getDefaultScramjetConfig().files.wasm;
	} catch {
		return false;
	}
}

function getScramjetDecodedTarget(requestUrl) {
	try {
		const parsed = new URL(requestUrl);
		const prefix = getScramjetPrefixPath();
		if (!parsed.pathname.startsWith(prefix)) return "";
		const encoded = parsed.pathname.slice(prefix.length);
		if (!encoded) return "";
		return decodeURIComponent(encoded);
	} catch {
		return "";
	}
}

function buildUvProxyUrl(targetUrl) {
	try {
		if (!targetUrl || !self.__uv$config?.prefix || !self.__uv$config?.encodeUrl) return "";
		return `${self.location.origin}${self.__uv$config.prefix}${self.__uv$config.encodeUrl(targetUrl)}`;
	} catch {
		return "";
	}
}

async function notifyClientsOfScramjetFailure(reason) {
	try {
		const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
		for (const client of clients) {
			client.postMessage({
				type: "frosted:proxy-fallback",
				proxy: "ultraviolet",
				reason: String(reason || "scramjet_failed"),
			});
		}
	} catch {}
}

function isFatalScramjetTransportError(error) {
	const message = String(error?.message || error || "").toLowerCase();
	const stack = String(error?.stack || "").toLowerCase();
	const detail = `${message}\n${stack}`;
	return (
		detail.includes("there are no bare clients") ||
		detail.includes("no baretransport was set") ||
		detail.includes("failed to get a ping response") ||
		detail.includes("messageport") ||
		detail.includes("muxtaskended") ||
		detail.includes("n.p_ is not a function")
	);
}

function buildScramjetUvFallbackResponse(requestUrl) {
	const target = getScramjetDecodedTarget(requestUrl);
	const uvUrl = buildUvProxyUrl(target);
	if (!uvUrl) return null;
	return Response.redirect(uvUrl, 302);
}

function isMissingObjectStoreError(error) {
	return (
		error?.name === "NotFoundError" &&
		String(error?.message || "").toLowerCase().includes("object store")
	);
}

function deleteIndexedDb(databaseName) {
	return new Promise((resolve, reject) => {
		try {
			var request = indexedDB.deleteDatabase(databaseName);
			request.onsuccess = () => resolve(true);
			request.onerror = () => reject(request.error || new Error(`Failed to delete IndexedDB database: ${databaseName}`));
			request.onblocked = () => resolve(false);
		} catch (error) {
			reject(error);
		}
	});
}

function validateScramjetDb(db) {
	const requiredStores = ["config", "cookies", "redirectTrackers", "referrerPolicies", "publicSuffixList"];
	return requiredStores.every((storeName) => db.objectStoreNames.contains(storeName));
}

async function ensureScramjetDbReady() {
	const db = await openScramjetDb();
	const isValid = validateScramjetDb(db);
	try {
		db.close();
	} catch {}
	if (isValid) return;
	console.warn("[frosted-sw] scramjet IndexedDB schema mismatch detected before worker startup; recreating $scramjet database.");
	await deleteIndexedDb("$scramjet");
	const recreatedDb = await openScramjetDb();
	try {
		recreatedDb.close();
	} catch {}
}

function openScramjetDb() {
	return new Promise((resolve, reject) => {
		try {
			var request = indexedDB.open("$scramjet", 1);
			request.onupgradeneeded = () => {
				var db = request.result;
				["config", "cookies", "redirectTrackers", "referrerPolicies", "publicSuffixList"].forEach((storeName) => {
					if (!db.objectStoreNames.contains(storeName)) {
						db.createObjectStore(storeName);
					}
				});
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error || new Error("Failed to open $scramjet IndexedDB."));
		} catch (error) {
			reject(error);
		}
	});
}

async function persistScramjetConfig(config) {
	const db = await openScramjetDb();
	await new Promise((resolve, reject) => {
		try {
			var tx = db.transaction(["config"], "readwrite");
			tx.objectStore("config").put(config, "config");
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error || new Error("Failed to persist scramjet config."));
			tx.onabort = () => reject(tx.error || new Error("Persisting scramjet config was aborted."));
		} catch (error) {
			reject(error);
		}
	});
	try {
		db.close();
	} catch {}
}

async function loadScramjetConfigWithRecovery() {
	try {
		await scramjet.loadConfig();
	} catch (error) {
		if (!isMissingObjectStoreError(error)) throw error;
		console.warn("[frosted-sw] scramjet IndexedDB schema mismatch detected; recreating $scramjet database.");
		await deleteIndexedDb("$scramjet");
		await scramjet.loadConfig();
	}
	scramjet.config = normalizeScramjetConfig(scramjet.config);
	if (!scramjet.config?.prefix) {
		scramjet.config = getDefaultScramjetConfig();
	}
	try {
		await persistScramjetConfig(getPersistableScramjetConfig(scramjet.config));
	} catch (error) {
		console.warn("[frosted-sw] failed to persist normalized scramjet config:", error);
	}
}

async function initializeScramjetServiceWorker() {
	await ensureScramjetDbReady();
	scramjet = new ScramjetServiceWorker();
	try {
		await loadScramjetConfigWithRecovery();
	} catch (error) {
		console.warn("[frosted-sw] initial scramjet config load failed:", error);
		void notifyClientsOfScramjetFailure("scramjet_config_load_failed");
	}
	return scramjet;
}

async function handleRequest(event) {
	if (isHardBlockedAdRequest(event.request)) {
		return new Response("Blocked by Frosted adblockdY'-", {
			status: 403,
			statusText: "Blocked by Frosted adblock",
			headers: {
				"content-type": "text/plain; charset=utf-8",
				"cache-control": "no-store",
			},
		});
	}

	if (isUvRequest(event.request.url)) {
		return uvServiceWorker.fetch(event);
	}

	if (isScramjetRequest(event.request.url) || isScramjetWasmRequest(event.request.url)) {
		if (scramjetCircuitOpen) {
			const fallback = buildScramjetUvFallbackResponse(event.request.url);
			if (fallback) return fallback;
		}
		try {
			await scramjetReadyPromise;
			await loadScramjetConfigWithRecovery();
			if (scramjet.route(event)) {
				return await scramjet.fetch(event);
			}
		} catch (error) {
			console.error("[frosted-sw] scramjet fetch failed:", error);
			if (isFatalScramjetTransportError(error)) {
				scramjetCircuitOpen = true;
			}
			void notifyClientsOfScramjetFailure("scramjet_fetch_failed");
			const fallback = buildScramjetUvFallbackResponse(event.request.url);
			if (fallback) return fallback;
			return new Response("Scramjet failed to load this page.", {
				status: 502,
				statusText: "Scramjet Error",
				headers: {
					"content-type": "text/plain; charset=utf-8",
					"cache-control": "no-store",
				},
			});
		}
		return new Response("Scramjet could not route this request.", {
			status: 502,
			statusText: "Scramjet Routing Error",
			headers: {
				"content-type": "text/plain; charset=utf-8",
				"cache-control": "no-store",
			},
		});
	}

	if (shouldBypassScramjet(event.request)) {
		return fetch(event.request);
	}

	return fetch(event.request);
}

self.addEventListener("fetch", (event) => {
	event.respondWith(handleRequest(event));
});
