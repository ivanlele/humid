import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

import "@/localization";

import "./popup.css";
import { initPegasusTransport } from "@webext-pegasus/transport/popup";
import React from "react";
import { createRoot } from "react-dom/client";
import browser from "webextension-polyfill";

import { ConfirmProvider } from "@/common/Confirmation";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { ThemeProvider } from "@/contexts/ThemeProvider";
import { initGlobalErrorReporting } from "@/core/report";
import { router } from "@/routes/router";
import { authStore } from "@/store/auth";

initPegasusTransport();
initGlobalErrorReporting();

window.addEventListener("keydown", (event) => {
	if (
		event.code !== "KeyR" ||
		!event.altKey ||
		!event.shiftKey ||
		event.repeat ||
		event.ctrlKey ||
		event.metaKey
	)
		return;
	event.preventDefault();
	void browser.tabs.create({ url: browser.runtime.getURL("src/rtx-on.html") });
});

const queryClient = new QueryClient();
const rootElement = document.getElementById("root");

if (!rootElement) {
	throw new Error("Popup root element was not found");
}

const root = createRoot(rootElement);

async function bootstrapPopup() {
	await authStore.ready();

	root.render(
		<React.StrictMode>
			<Popup />
		</React.StrictMode>,
	);
}

void bootstrapPopup();

function Popup() {
	return (
		<AppErrorBoundary>
			<ThemeProvider>
				<QueryClientProvider client={queryClient}>
					<ConfirmProvider>
						<PopupContent />
					</ConfirmProvider>
				</QueryClientProvider>
			</ThemeProvider>
		</AppErrorBoundary>
	);
}

function PopupContent() {
	return <RouterProvider router={router} />;
}
