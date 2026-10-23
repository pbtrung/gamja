import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter/index.css";
import "@fontsource-variable/inter/wght-italic.css";
import "./styles/index.css";
import AppController from "./app/controller";
import App from "./components/App";
import { reloadIfOutdated } from "./app/update";

const controller = new AppController();

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App controller={controller} />
	</StrictMode>,
);

// Before connecting, not to connect twice if the page is reloaded
void reloadIfOutdated().then((reloading) => {
	if (!reloading) {
		controller.start().catch((err) => controller.showError(err));
	}
});
