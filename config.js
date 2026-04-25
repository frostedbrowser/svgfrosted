const defaultConfig = {
	WISP_URL: "wss://stellite.games/wisp/",
	PROXY_ORIGIN: "https://stellite.games",
};

if (typeof window !== "undefined") {
	var existingConfig = window._CONFIG && typeof window._CONFIG === "object" ? window._CONFIG : {};
	window._CONFIG = Object.assign({}, existingConfig, defaultConfig);
	window._CONFIG.WISP_URL = defaultConfig.WISP_URL;
	window._CONFIG.PROXY_ORIGIN = defaultConfig.PROXY_ORIGIN;
	window.WISP_URL = defaultConfig.WISP_URL;
	window.PROXY_ORIGIN = defaultConfig.PROXY_ORIGIN;
}
