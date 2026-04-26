const defaultConfig = {
	WISP_URL: "wss://fern.best/wisp/",
};

if (typeof window !== "undefined") {
	var existingConfig = window._CONFIG && typeof window._CONFIG === "object" ? window._CONFIG : {};
	window._CONFIG = Object.assign({}, existingConfig, defaultConfig);
	window._CONFIG.WISP_URL = defaultConfig.WISP_URL;
	window.WISP_URL = defaultConfig.WISP_URL;
}
