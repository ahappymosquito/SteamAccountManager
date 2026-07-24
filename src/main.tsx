/** React webview bootstrap and shared Radix providers. */
import React from "react";
import ReactDOM from "react-dom/client";
import * as Tooltip from "@radix-ui/react-tooltip";
import App from "./App";
import { renderTheme, savedTheme } from "./lib/themes";
import "./styles.css";

renderTheme(savedTheme());

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><Tooltip.Provider delayDuration={400}><App /></Tooltip.Provider></React.StrictMode>);
