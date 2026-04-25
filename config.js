const defaultConfig = {
	WISP_URL: "wss://stellite.games/wisp/",
};

if (typeof window !== "undefined") {
	var existingConfig = window._CONFIG && typeof window._CONFIG === "object" ? window._CONFIG : {};
	window._CONFIG = Object.assign({}, defaultConfig, existingConfig);
	if (!window.WISP_URL && window._CONFIG.WISP_URL) {
		window.WISP_URL = window._CONFIG.WISP_URL;
	}
}
