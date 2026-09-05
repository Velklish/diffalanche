import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { observeLongTasks, perf } from "./perf.ts";
import "./tokens.css";
import "./fonts.css";
import "./styles.css";

window.__perf = perf;
observeLongTasks();

const container = document.getElementById("root");
if (!container) throw new Error("no #root");
createRoot(container).render(<App />);
