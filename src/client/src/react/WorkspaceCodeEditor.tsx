import { useEffect, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";

interface WorkspaceCodeEditorProps {
  readonly path: string;
  readonly value: string;
  readonly readOnly: boolean;
  readonly onChange: (value: string) => void;
}

export function WorkspaceCodeEditor({ path, value, readOnly, onChange }: WorkspaceCodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | undefined>(undefined);
  const editable = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const parent = host.current;
    if (parent === null) return;
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [EditorView.contentAttributes.of({ "aria-label": `Editor for ${path}` }), lineNumbers(), history(), drawSelection(), highlightActiveLine(), keymap.of([...defaultKeymap, ...historyKeymap]), languageForPath(path), syntaxHighlighting(defaultHighlightStyle), editable.current.of(EditorView.editable.of(!readOnly)), EditorView.updateListener.of(update => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        })],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = undefined;
    };
  }, [path]);

  useEffect(() => {
    const editor = view.current;
    if (editor === undefined || editor.state.doc.toString() === value) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const editor = view.current;
    if (editor === undefined) return;
    editor.dispatch({ effects: editable.current.reconfigure(EditorView.editable.of(!readOnly)) });
  }, [readOnly]);

  return <div className="rw-code-editor" ref={host} aria-label={`Editor for ${path}`} />;
}

export function languageForPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  if (["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"].includes(extension ?? "")) return javascript({ jsx: true, typescript: ["ts", "tsx", "mts", "cts"].includes(extension ?? "") });
  if (extension === "css" || extension === "scss") return css();
  if (["html", "htm", "xml", "svg"].includes(extension ?? "")) return html();
  if (extension === "json" || extension === "jsonc") return json();
  if (["md", "mdx"].includes(extension ?? "")) return markdown();
  if (extension === "py") return python();
  if (extension === "rs") return rust();
  if (extension === "go") return go();
  return [];
}
