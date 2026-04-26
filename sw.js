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
// Scramjet must attach its internal message handler during initial SW evaluation.
let scramjet = new ScramjetServiceWorker();
let scramjetCircuitOpen = false;
let scramjetReadyPromise = Promise.resolve(null);
let scramjetUnhandledSchemaMismatchSeen = false;
const scramjetAssetVersion = "6";

self.addEventListener("unhandledrejection", (event) => {
	const reason = event?.reason;
	const stack = String(reason?.stack || "");
	if (!isMissingObjectStoreError(reason)) return;
	if (!stack.includes("scramjet.all.js")) return;
	event.preventDefault();
	if (scramjetUnhandledSchemaMismatchSeen) return;
	scramjetUnhandledSchemaMismatchSeen = true;
	console.warn(
		"[frosted-sw] intercepted early scramjet IndexedDB schema mismatch; continuing with serialized startup recovery."
	);
});

const hardBlockedAdKeywords = [
	"adblock.turtlecute.org/js/pagead.js",
	"adblock.turtlecute.org/js/widget/ads.js",
	"https%3a%2f%2fadblock.turtlecute.org%2fjs%2fpagead.js",
	"https%3a%2f%2fadblock.turtlecute.org%2fjs%2fwidget%2fads.js",
	"api-adservices.apple.com",
	"iadsdk.apple.com",
	"metrics.icloud.com",
	"metrics.mzstatic.com",
	"adtech.yahooinc.com",
	"unityads.unity3d.com",
	"auction.unityads.unity3d.com",
	"webview.unityads.unity3d.com",
	"config.unityads.unity3d.com",
	"adserver.unityads.unity3d.com",
	"bdapi-ads.realmemobile.com",
	"bdapi-in-ads.realmemobile.com",
	"iot-eu-logser.realme.com",
	"iot-logser.realme.com",
	"adsfs.oppomobile.com",
	"adx.ads.oppomobile.com",
	"ck.ads.oppomobile.com",
	"data.ads.oppomobile.com",
];
const hardAllowedAdUrlPatterns = [
	/^https?:\/\/cdn\.r9x\.in\/ailogic_gn-math\.dev_obf\.js(?:[?#].*)?$/i,
	/^https?:\/\/cdn\.r9x\.in\/geo\.js(?:[?#].*)?$/i,
	/^https?:\/\/(?:[^/]+\.)?jsdelivr\.net\/.+$/i,
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

scramjetReadyPromise = initializeScramjetServiceWorker();

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

function isHardAllowedAdRequest(request) {
	try {
		const rawUrl = String(request?.url || "").trim();
		if (!rawUrl) return false;
		const parsed = new URL(rawUrl);
		const href = parsed.href.toLowerCase();
		return hardAllowedAdUrlPatterns.some((pattern) => pattern.test(href));
	} catch {}
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

function withScramjetAssetVersion(path) {
	const basePath = String(path || "").trim();
	if (!basePath) return "";
	const separator = basePath.includes("?") ? "&" : "?";
	return `${basePath}${separator}v=${scramjetAssetVersion}`;
}

function getDefaultScramjetCodecConfig() {
	return {
		encode: "(value) => (value ? encodeURIComponent(value) : value)",
		decode: "(value) => (value ? decodeURIComponent(value) : value)",
	};
}

function normalizeCodecSource(value) {
	if (typeof value === "function") {
		try {
			return value.toString();
		} catch {
			return "";
		}
	}
	if (typeof value === "string") return value;
	return "";
}

function hasSafeCodecSource(value, expectedToken) {
	return normalizeCodecSource(value).toLowerCase().includes(expectedToken);
}

function normalizeScramjetCodecValue(value, fallback) {
	if (typeof value === "function") {
		return value.toString();
	}
	if (typeof value === "string" && value.trim()) {
		return value;
	}
	return fallback;
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
			wasm: withScramjetAssetVersion(`${appBasePath}scram/scramjet.wasm.wasm`),
			all: withScramjetAssetVersion(`${appBasePath}scram/scramjet.all.js`),
			sync: withScramjetAssetVersion(`${appBasePath}scram/scramjet.sync.js`),
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
		codec: getDefaultScramjetCodecConfig(),
	};
}

function getPersistableScramjetConfig(config) {
	const normalized = normalizeScramjetConfig(config);
	return {
		prefix: normalized.prefix,
		globals: { ...(normalized.globals || {}) },
		files: { ...(normalized.files || {}) },
		flags: { ...(normalized.flags || {}) },
		siteFlags: { ...(normalized.siteFlags || {}) },
		codec: { ...(normalized.codec || {}) },
	};
}

function normalizeScramjetConfig(config) {
	const defaults = getDefaultScramjetConfig();
	const candidate = config && typeof config === "object" ? config : {};
	const normalized = {
		...defaults,
		...candidate,
		globals: { ...defaults.globals, ...(candidate.globals || {}) },
		files: { ...defaults.files, ...(candidate.files || {}) },
		flags: { ...defaults.flags, ...(candidate.flags || {}) },
		siteFlags: { ...defaults.siteFlags, ...(candidate.siteFlags || {}) },
		codec: {
			encode: normalizeScramjetCodecValue(candidate.codec?.encode, defaults.codec.encode),
			decode: normalizeScramjetCodecValue(candidate.codec?.decode, defaults.codec.decode),
		},
	};
	if (!hasSafeScramjetCodec(normalized)) {
		normalized.codec = { ...defaults.codec };
	}
	return normalized;
}

function hasValidScramjetCodec(config) {
	return Boolean(config?.codec?.encode && config?.codec?.decode);
}

function hasSafeScramjetCodec(config) {
	return (
		hasSafeCodecSource(config?.codec?.encode, "encodeuricomponent") &&
		hasSafeCodecSource(config?.codec?.decode, "decodeuricomponent")
	);
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
		const decoded = decodeURIComponent(encoded);
		return normalizeLikelyMalformedTargetUrl(decoded);
	} catch {
		return "";
	}
}

function normalizeLikelyMalformedTargetUrl(value) {
	const target = String(value || "").trim();
	if (!target) return "";
	return target.replace(/^((?:https?|wss?)):\/(?!\/)/i, "$1://");
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

function isDbConnectionClosedError(error) {
	const name = String(error?.name || "");
	const message = String(error?.message || "").toLowerCase();
	return name === "AbortError" || message.includes("connection was closed");
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
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
	await resetScramjetDbWithRetry();
}

async function resetScramjetDbWithRetry() {
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			const deleted = await deleteIndexedDb("$scramjet");
			if (deleted === false) {
				await delay(60 * attempt);
				continue;
			}
			const recreatedDb = await openScramjetDb();
			try {
				recreatedDb.close();
			} catch {}
			return true;
		} catch (error) {
			if (!isDbConnectionClosedError(error)) throw error;
			await delay(60 * attempt);
		}
	}
	return false;
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

async function readPersistedScramjetConfig() {
	const db = await openScramjetDb();
	try {
		return await new Promise((resolve, reject) => {
			try {
				var tx = db.transaction(["config"], "readonly");
				var request = tx.objectStore("config").get("config");
				request.onsuccess = () => resolve(request.result || null);
				request.onerror = () => reject(request.error || new Error("Failed to read scramjet config."));
				tx.onabort = () => reject(tx.error || new Error("Reading scramjet config was aborted."));
			} catch (error) {
				reject(error);
			}
		});
	} finally {
		try {
			db.close();
		} catch {}
	}
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

async function repairPersistedScramjetConfig() {
	const storedConfig = await readPersistedScramjetConfig();
	const normalizedConfig = normalizeScramjetConfig(storedConfig);
	if (
		!storedConfig ||
		!storedConfig.prefix ||
		!storedConfig.files ||
		!hasValidScramjetCodec(storedConfig) ||
		!hasSafeScramjetCodec(storedConfig)
	) {
		await persistScramjetConfig(getPersistableScramjetConfig(normalizedConfig));
	}
	return normalizedConfig;
}

async function loadScramjetConfigWithRecovery() {
	let repairedConfig;
	try {
		repairedConfig = await repairPersistedScramjetConfig();
	} catch (error) {
		if (!isMissingObjectStoreError(error) && !isDbConnectionClosedError(error)) throw error;
		console.warn("[frosted-sw] scramjet config store unavailable during repair; retrying with fresh database.");
		const resetWorked = await resetScramjetDbWithRetry();
		if (!resetWorked) throw error;
		repairedConfig = getDefaultScramjetConfig();
		await persistScramjetConfig(getPersistableScramjetConfig(repairedConfig));
	}
	try {
		await scramjet.loadConfig();
	} catch (error) {
		if (isMissingObjectStoreError(error) || isDbConnectionClosedError(error)) {
			console.warn("[frosted-sw] scramjet IndexedDB/config unavailable; recreating $scramjet database.");
			const resetWorked = await resetScramjetDbWithRetry();
			if (!resetWorked) throw error;
			await persistScramjetConfig(getPersistableScramjetConfig(getDefaultScramjetConfig()));
			await scramjet.loadConfig();
		} else if (hasValidScramjetCodec(repairedConfig) && hasSafeScramjetCodec(repairedConfig)) {
			console.warn("[frosted-sw] recovered malformed scramjet config from IndexedDB.");
			scramjet.config = repairedConfig;
		} else {
			throw error;
		}
	}
	scramjet.config = normalizeScramjetConfig(scramjet.config || repairedConfig);
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
	try {
		await loadScramjetConfigWithRecovery();
	} catch (error) {
		console.warn("[frosted-sw] initial scramjet config load failed:", error);
		void notifyClientsOfScramjetFailure("scramjet_config_load_failed");
	}
	return scramjet;
}

async function handleRequest(event) {
	if (isHardAllowedAdRequest(event.request)) {
		try {
			return await fetch(event.request);
		} catch (error) {
			console.warn("[frosted-sw] hard-allow fetch failed:", event.request.url, error);
			return new Response("Upstream request failed.", {
				status: 502,
				statusText: "Upstream Fetch Error",
				headers: {
					"content-type": "text/plain; charset=utf-8",
					"cache-control": "no-store",
				},
			});
		}
	}

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
		try {
			return await fetch(event.request);
		} catch (error) {
			console.warn("[frosted-sw] bypass fetch failed:", event.request.url, error);
			return new Response("Upstream request failed.", {
				status: 502,
				statusText: "Upstream Fetch Error",
				headers: {
					"content-type": "text/plain; charset=utf-8",
					"cache-control": "no-store",
				},
			});
		}
	}

	try {
		return await fetch(event.request);
	} catch (error) {
		console.warn("[frosted-sw] direct fetch failed:", event.request.url, error);
		return new Response("Upstream request failed.", {
			status: 502,
			statusText: "Upstream Fetch Error",
			headers: {
				"content-type": "text/plain; charset=utf-8",
				"cache-control": "no-store",
			},
		});
	}
}

self.addEventListener("fetch", (event) => {
	event.respondWith(handleRequest(event));
});
