"use strict";
const stockSW = "./sw.js?v=6";
const swReadyTimeoutMs = 4000;

/**
 * List of hostnames that are allowed to run serviceworkers on http://
 */
const swAllowedHostnames = ["localhost", "127.0.0.1"];

/**
 * Global util
 * Used in 404.html and index.html
 */
function withTimeout(promise, timeoutMs, fallbackValue = null) {
	return new Promise((resolve, reject) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			resolve(fallbackValue);
		}, timeoutMs);

		Promise.resolve(promise).then(
			(value) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				reject(error);
			}
		);
	});
}

async function registerSW() {
	if (!navigator.serviceWorker) {
		if (
			location.protocol !== "https:" &&
			!swAllowedHostnames.includes(location.hostname)
		)
			throw new Error("Service workers cannot be registered without https.");

		throw new Error("Your browser doesn't support service workers.");
	}

	const registration = await navigator.serviceWorker.register(stockSW);
	if (registration.waiting) {
		registration.waiting.postMessage({ type: "SKIP_WAITING" });
	}
	await withTimeout(navigator.serviceWorker.ready, swReadyTimeoutMs, registration);

	if (!navigator.serviceWorker.controller) {
		await withTimeout(new Promise((resolve) => {
			let settled = false;
			const finish = () => {
				if (settled) return;
				settled = true;
				navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
				resolve();
			};
			const onControllerChange = () => finish();
			navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
			setTimeout(finish, 1500);
		}), swReadyTimeoutMs, null);
	}

	return registration;
}

if (typeof window !== "undefined") {
	window.registerSW = registerSW;
}
