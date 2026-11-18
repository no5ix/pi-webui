import { createRoot } from "react-dom/client";
import { ReactWorkspaceApp } from "./react/ReactWorkspaceApp";
import "./react/workspace.css";

const root = document.getElementById("root");
if (!root) throw new Error("React workspace root was not found");
createRoot(root).render(<ReactWorkspaceApp />);
