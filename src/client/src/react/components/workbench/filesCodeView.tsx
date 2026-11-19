import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { bracketMatching, StreamLanguage, defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css as cssLanguage } from "@codemirror/lang-css";
import { go as goLanguage } from "@codemirror/lang-go";
import { html as htmlLanguage } from "@codemirror/lang-html";
import { javascript as javascriptLanguage } from "@codemirror/lang-javascript";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { python as pythonLanguage } from "@codemirror/lang-python";
import { rust as rustLanguage } from "@codemirror/lang-rust";
import { diff as diffStream } from "@codemirror/legacy-modes/mode/diff";
import { shell as shellStream } from "@codemirror/legacy-modes/mode/shell";
import { yaml as yamlStream } from "@codemirror/legacy-modes/mode/yaml";

/**
 * The Files surface's code view, on the CodeMirror the app already loads.
 *
 * The same mount serves the editor and the read-only views - source, and a git
 * diff, which is a mode of its own - because the syntax engine, the line ruler
 * and the theme are the thing being reused. `language` is the label the machine's
 * own read gives a file (`typescript`, `markdown`, `diff` for a patch), and a
 * name it does not send leaves the text plain, which is what a plain file is.
 *
 * The colors are the shell's tokens: CodeMirror's theme writes the values into
 * its own stylesheet as `var(...)` references, so a plugin theme, a light theme
 * and the reference dark all keep the file's ink and ruler in step with the rest
 * of the panel.
 */
export interface FilesCodeViewProps {
  value: string;
  language: string | undefined;
  editable: boolean;
  label: string;
  onInput: (value: string) => void;
  onSave: () => void;
}

export function FilesCodeView(props: FilesCodeViewProps): ReactNode {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const handlers = useRef({ input: props.onInput, save: props.onSave });

  useEffect(() => {
    handlers.current = { input: props.onInput, save: props.onSave };
  }, [props.onInput, props.onSave]);

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const mounted = new EditorView({
      parent: element,
      state: EditorState.create({
        doc: props.value,
        extensions: viewExtensions(props.language, props.editable, props.label, handlers),
      }),
    });
    view.current = mounted;
    return () => {
      mounted.destroy();
      view.current = null;
    };
  }, [props.label, props.language, props.editable]);

  useEffect(() => {
    const mounted = view.current;
    if (mounted === null) return;
    const shown = mounted.state.doc.toString();
    if (shown === props.value) return;
    mounted.dispatch({
      changes: { from: 0, to: shown.length, insert: props.value },
      selection: { anchor: Math.min(props.value.length, mounted.state.selection.main.head) },
    });
  }, [props.value]);

  return <div aria-label={props.label} className="piw-files__code" ref={host} role="group" />;
}

interface Handlers {
  input: (value: string) => void;
  save: () => void;
}

function viewExtensions(language: string | undefined, editable: boolean, label: string, handlers: RefObject<Handlers>): Extension[] {
  const extensions: Extension[] = [
    lineNumbers(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    EditorView.lineWrapping,
    filesTheme,
    EditorState.readOnly.of(!editable),
    EditorView.editable.of(editable),
    EditorView.contentAttributes.of({ "aria-label": label, "aria-multiline": "true", dir: "auto" }),
    keymap.of([{ key: "Mod-s", preventDefault: true, run: () => { handlers.current.save(); return true; } }]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) handlers.current.input(update.state.doc.toString());
    }),
  ];
  if (editable) extensions.push(history(), keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]));
  extensions.push(...languageExtensions(language));
  return extensions;
}

/**
 * The machine names a file's language from its name; these are the grammars the
 * app already ships. A language with no grammar here is shown as plain text,
 * which is honest and loses nothing but colour.
 */
const languageModes: Readonly<Record<string, () => Extension>> = {
  css: () => cssLanguage(),
  diff: () => StreamLanguage.define(diffStream),
  go: () => goLanguage(),
  html: () => htmlLanguage(),
  javascript: () => javascriptLanguage(),
  json: () => jsonLanguage(),
  markdown: () => markdownLanguage(),
  python: () => pythonLanguage(),
  rust: () => rustLanguage(),
  shell: () => StreamLanguage.define(shellStream),
  typescript: () => javascriptLanguage({ typescript: true }),
  yaml: () => StreamLanguage.define(yamlStream),
};

function languageExtensions(language: string | undefined): Extension[] {
  if (language === undefined) return [];
  const mode = languageModes[language];
  return mode === undefined ? [] : [mode()];
}

const filesTheme = EditorView.theme({
  "&": { height: "100%", color: "var(--piw-ink)", backgroundColor: "transparent", fontSize: "var(--piw-size-mono)" },
  ".cm-scroller": { fontFamily: "var(--pi-font-mono)", lineHeight: "var(--pi-leading-normal)" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--piw-ink-faint)", border: "none" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
  ".cm-content": { caretColor: "var(--piw-ink)", paddingBlock: "var(--pi-space-2)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--piw-ink)" },
  ".cm-selectionBackground, .cm-content ::selection": { backgroundColor: "var(--piw-surface-selected)" },
  ".cm-line": { unicodeBidi: "plaintext" },
  "&.cm-focused": { outline: "var(--pi-focus-ring-width) solid var(--pi-focus-ring)", outlineOffset: "var(--pi-focus-ring-offset-inset)" },
});
