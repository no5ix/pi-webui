import { createRoot } from "react-dom/client";
import { publishReactRuntimeForPlugins } from "./react/pluginReactRuntime";
import { ReactWorkspaceApp } from "./react/ReactWorkspaceApp";
import "./react/workspace.css";

const root = document.getElementById("root");
if (!root) throw new Error("React workspace root was not found");
publishReactRuntimeForPlugins();
createRoot(root).render(<ReactWorkspaceApp />);
