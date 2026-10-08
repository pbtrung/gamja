import "@fontsource-variable/inter/index.css";
import "@fontsource-variable/inter/wght-italic.css";
import "bootstrap/dist/css/bootstrap.min.css";
import "./style.css";

import { html, render } from "./lib/index.js";
import App from "./components/app.js";

// Bootstrap only switches themes via the data-bs-theme attribute, so follow
// the system color scheme manually
let darkMode = window.matchMedia("(prefers-color-scheme: dark)");
function updateTheme() {
	document.documentElement.dataset.bsTheme = darkMode.matches ? "dark" : "light";
}
updateTheme();
darkMode.addEventListener("change", updateTheme);

render(html`<${App} />`, document.body);
