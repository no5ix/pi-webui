import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/shell.css";
import "./styles/primitives.css";
import { App } from "./app/App";
import { repaintTheme } from "./state/theme";

/**
 * The React app's mount point.
 *
 * The theme is painted before the first render, so the first frame is already
 * the reader's look: the pre-JavaScript paint in `index.html` covers the native
 * palettes, and this covers a plugin theme the paint script could not know.
 */
export function mountReactApp(root: HTMLElement): void {
  repaintTheme();
  createRoot(root).render(<App />);
}
