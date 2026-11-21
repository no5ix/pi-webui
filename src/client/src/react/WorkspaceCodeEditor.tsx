import { useEffect, useMemo, useRef, useState } from "react";
import { Compartment, EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers, type DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, StreamLanguage, bracketMatching, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { properties } from "@codemirror/legacy-modes/mode/properties";

export interface WorkspaceCodeEditorProps {
  readonly path: string;
  readonly value: string;
  readonly readOnly: boolean;
  readonly onChange: (path: string, value: string) => void;
  readonly onSave?: ((path: string) => void) | undefined;
  readonly onSaveAll?: (() => void) | undefined;
}

interface TextMatch {
  readonly from: number;
  readonly to: number;
}

export interface SearchOptions {
  readonly caseSensitive?: boolean;
  readonly wholeWord?: boolean;
}

/** Every non-overlapping occurrence of `query`, in document order. */
export function findTextMatches(text: string, query: string, options?: SearchOptions): TextMatch[] {
  if (query === "") return [];
  const haystack = options?.caseSensitive === true ? text : text.toLocaleLowerCase();
  const needle = options?.caseSensitive === true ? query : query.toLocaleLowerCase();
  const matches: TextMatch[] = [];
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    const end = index + needle.length;
    const before = index === 0 ? "" : text[index - 1] ?? "";
    const after = text[end] ?? "";
    const isolated = options?.wholeWord !== true || (isWordBoundary(before) && isWordBoundary(after));
    if (isolated) matches.push({ from: index, to: end });
    index = haystack.indexOf(needle, Math.max(end, index + 1));
  }
  return matches;
}

function isWordBoundary(character: string): boolean {
  return character === "" || !/[\p{L}\p{N}_]/u.test(character);
}

const setSearchHighlights = StateEffect.define<readonly TextMatch[]>();

const searchHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setSearchHighlights)) continue;
      next = Decoration.set(effect.value.map(match => Decoration.mark({ class: "rw-search-match" }).range(match.from, match.to)));
    }
    return next;
  },
  provide: field => EditorView.decorations.from(field),
});

const workspaceEditorTheme = EditorView.theme({
  "&": { height: "100%", color: "var(--rw-text)", backgroundColor: "var(--rw-window)", fontSize: "12px" },
  ".cm-scroller": { fontFamily: "var(--rw-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)", lineHeight: "1.55" },
  ".cm-content": { padding: "8px 0", caretColor: "var(--rw-accent)" },
  ".cm-line": { padding: "0 10px" },
  ".cm-gutters": { backgroundColor: "var(--rw-window)", color: "var(--rw-muted)", borderRight: "1px solid var(--rw-line)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 10px", minWidth: "34px" },
  ".cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--rw-accent) 10%, transparent)", color: "var(--rw-text)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--rw-accent) 6%, transparent)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "color-mix(in srgb, var(--rw-accent) 30%, transparent)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--rw-accent)" },
  ".cm-matchingBracket": { backgroundColor: "color-mix(in srgb, var(--rw-accent) 24%, transparent)", outline: "1px solid color-mix(in srgb, var(--rw-accent) 45%, transparent)" },
  ".cm-tooltip": { border: "1px solid var(--rw-line)", backgroundColor: "var(--rw-panel)", color: "var(--rw-text)" },
  ".rw-search-match": { backgroundColor: "color-mix(in srgb, #d7ba7d 32%, transparent)", borderRadius: "2px" },
  "&.cm-focused": { outline: "none" },
}, { dark: true });

const workspaceHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#c792ea" },
  { tag: [tags.atom, tags.bool, tags.number, tags.null], color: "#f5c97b" },
  { tag: [tags.string, tags.special(tags.string)], color: "#a5e3a0" },
  { tag: [tags.regexp, tags.escape], color: "#f78c6c" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "#6f7b8a", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "#82aaff" },
  { tag: [tags.definition(tags.variableName), tags.variableName], color: "#e6edf3" },
  { tag: [tags.propertyName, tags.attributeName], color: "#9cdcfe" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "#7fd6c8" },
  { tag: [tags.operator, tags.punctuation], color: "#c9d1d9" },
  { tag: [tags.meta, tags.processingInstruction], color: "#d2a8ff" },
  { tag: tags.heading, color: "#82aaff", fontWeight: "700" },
  { tag: tags.strong, color: "#f0f6fc", fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, color: "#82aaff", textDecoration: "underline" },
  { tag: tags.invalid, color: "#f97583" },
]);

interface EditorMemory {
  readonly anchor: number;
  readonly head: number;
  readonly scrollTop: number;
}

export function WorkspaceCodeEditor({ path, value, readOnly, onChange, onSave, onSaveAll }: WorkspaceCodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | undefined>(undefined);
  const editable = useRef(new Compartment());
  const pathRef = useRef(path);
  pathRef.current = path;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onSaveAllRef = useRef(onSaveAll);
  onSaveAllRef.current = onSaveAll;
  const memories = useRef(new Map<string, EditorMemory>());
  const initialDocument = useRef(value);
  const [searchOpen, setSearchOpen] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [matchIndex, setMatchIndex] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => findTextMatches(value, query, { caseSensitive, wholeWord }), [value, query, caseSensitive, wholeWord]);
  const matchesRef = useRef(matches);
  matchesRef.current = matches;

  const openSearch = (replace: boolean) => {
    setSearchOpen(true);
    setShowReplace(replace);
    requestAnimationFrame(() => {
      searchInput.current?.focus();
      searchInput.current?.select();
    });
  };
  const openSearchRef = useRef(openSearch);
  openSearchRef.current = openSearch;

  useEffect(() => {
    const parent = host.current;
    if (parent === null) return;
    const memoryMap = memories.current;
    const memory = memoryMap.get(path);
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: initialDocument.current,
        ...(memory === undefined ? {} : { selection: { anchor: memory.anchor, head: memory.head } }),
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          EditorView.lineWrapping,
          workspaceEditorTheme,
          syntaxHighlighting(workspaceHighlightStyle),
          searchHighlightField,
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => { onSaveRef.current?.(pathRef.current); return true; } },
            { key: "Mod-Shift-s", preventDefault: true, run: () => { onSaveAllRef.current?.(); return true; } },
            { key: "Mod-f", preventDefault: true, run: () => { openSearchRef.current(false); return true; } },
            { key: "Mod-h", preventDefault: true, run: () => { openSearchRef.current(true); return true; } },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          languageForPath(path),
          editable.current.of(EditorView.editable.of(!readOnlyRef.current)),
          EditorView.updateListener.of(update => {
            if (update.docChanged) onChangeRef.current(pathRef.current, update.state.doc.toString());
          }),
          EditorView.contentAttributes.of({ "aria-label": `Editor for ${pathRef.current}` }),
        ],
      }),
    });
    view.current = editor;
    if (memory !== undefined) {
      editor.scrollDOM.scrollTop = memory.scrollTop;
      requestAnimationFrame(() => { editor.scrollDOM.scrollTop = memory.scrollTop; });
    }
    return () => {
      const current = view.current;
      if (current !== undefined) {
        const selection = current.state.selection.main;
        memoryMap.set(pathRef.current, { anchor: selection.anchor, head: selection.head, scrollTop: current.scrollDOM.scrollTop });
      }
      editor.destroy();
      view.current = undefined;
    };
    // The editor is built from the document it was handed at mount and rebuilt only when the open
    // path changes; a later value flows through the effect below, so a keystroke never tears down
    // the editor and its history.
  }, [path]);

  useEffect(() => {
    const editor = view.current;
    if (editor === undefined) return;
    const current = editor.state.doc.toString();
    if (current === value) return;
    const { anchor, head } = editor.state.selection.main;
    editor.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: { anchor: Math.min(anchor, value.length), head: Math.min(head, value.length) },
    });
  }, [value]);

  useEffect(() => {
    const editor = view.current;
    if (editor === undefined) return;
    editor.dispatch({ effects: editable.current.reconfigure(EditorView.editable.of(!readOnly)) });
  }, [readOnly, path]);

  useEffect(() => {
    const editor = view.current;
    if (editor === undefined) return;
    editor.dispatch({ effects: setSearchHighlights.of(matches) });
  }, [matches, path]);

  useEffect(() => {
    setMatchIndex(0);
    const hits = matchesRef.current;
    if (hits.length === 0) return;
    const first = hits[0];
    if (first === undefined) return;
    const editor = view.current;
    if (editor === undefined || !searchOpen) return;
    editor.dispatch({ selection: { anchor: first.from, head: first.to }, effects: EditorView.scrollIntoView(first.from, { y: "center" }) });
    // Selecting the first hit belongs to opening or changing the search, not to
    // every keystroke in the document, so the hits are read as they are then.
  }, [query, caseSensitive, wholeWord, searchOpen]);

  const goToMatch = (direction: 1 | -1) => {
    if (matches.length === 0) return;
    const next = (matchIndex + direction + matches.length) % matches.length;
    setMatchIndex(next);
    const match = matches[next];
    const editor = view.current;
    if (match === undefined || editor === undefined) return;
    editor.dispatch({ selection: { anchor: match.from, head: match.to }, effects: EditorView.scrollIntoView(match.from, { y: "center" }) });
    editor.focus();
  };

  const replaceCurrent = () => {
    const editor = view.current;
    const match = matches[matchIndex];
    if (editor === undefined || match === undefined) return;
    editor.dispatch({ changes: { from: match.from, to: match.to, insert: replacement }, selection: { anchor: match.from + replacement.length } });
    editor.focus();
  };

  const replaceAll = () => {
    const editor = view.current;
    if (editor === undefined || matches.length === 0) return;
    editor.dispatch({ changes: matches.map(match => ({ from: match.from, to: match.to, insert: replacement })) });
    editor.focus();
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    view.current?.focus();
  };

  return <div className="rw-code-editor-shell">
    <div className="rw-code-editor" ref={host} aria-label={`Editor for ${path}`}/>
    {searchOpen && <div className="rw-editor-find" role="search" aria-label="Find in file" onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); closeSearch(); }
      else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); goToMatch(1); }
      else if (event.key === "Enter" && event.shiftKey) { event.preventDefault(); goToMatch(-1); }
    }}>
      <div className="rw-editor-find-row">
        <input ref={searchInput} aria-label="Search in file" placeholder="Find" value={query} onChange={event => setQuery(event.target.value)}/>
        <span aria-live="polite">{query === "" ? "" : matches.length === 0 ? "No results" : `${String(matchIndex + 1)}/${String(matches.length)}`}</span>
        <button type="button" title="Previous match" aria-label="Previous match" disabled={matches.length === 0} onClick={() => goToMatch(-1)}>↑</button>
        <button type="button" title="Next match" aria-label="Next match" disabled={matches.length === 0} onClick={() => goToMatch(1)}>↓</button>
        <button type="button" className={showReplace ? "active" : ""} title="Replace" aria-label="Toggle replace" onClick={() => setShowReplace(current => !current)}>⇄</button>
        <button type="button" title="Close search" aria-label="Close search" onClick={closeSearch}>×</button>
      </div>
      {showReplace && <div className="rw-editor-find-row">
        <input aria-label="Replace with" placeholder="Replace" value={replacement} onChange={event => setReplacement(event.target.value)}/>
        <button type="button" disabled={matches.length === 0} onClick={replaceCurrent}>Replace</button>
        <button type="button" disabled={matches.length === 0} onClick={replaceAll}>All</button>
      </div>}
      <div className="rw-editor-find-options">
        <label><input type="checkbox" checked={caseSensitive} onChange={event => setCaseSensitive(event.target.checked)}/> Match case</label>
        <label><input type="checkbox" checked={wholeWord} onChange={event => setWholeWord(event.target.checked)}/> Whole word</label>
      </div>
    </div>}
  </div>;
}

export function languageForPath(path: string): Extension {
  const name = path.split("/").pop() ?? path;
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return StreamLanguage.define(dockerFile);
  if (lower === "makefile" || lower === ".gitignore" || lower === ".npmrc" || lower === ".editorconfig" || lower === ".env" || lower.startsWith(".env.")) return StreamLanguage.define(properties);
  const extension = lower.includes(".") ? lower.split(".").pop() ?? "" : "";
  if (["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"].includes(extension)) return javascript({ jsx: extension !== "ts" && extension !== "mts" && extension !== "cts", typescript: ["ts", "tsx", "mts", "cts"].includes(extension) });
  if (extension === "css" || extension === "scss" || extension === "sass" || extension === "less") return css();
  if (["html", "htm", "xml", "svg", "vue", "svelte"].includes(extension)) return html();
  if (extension === "json" || extension === "jsonc") return json();
  if (extension === "md" || extension === "mdx") return markdown();
  if (extension === "py") return python();
  if (extension === "rs") return rust();
  if (extension === "go") return go();
  if (extension === "sh" || extension === "bash" || extension === "zsh" || extension === "fish" || extension === "ksh") return StreamLanguage.define(shell);
  if (extension === "yml" || extension === "yaml") return StreamLanguage.define(yaml);
  if (extension === "toml") return StreamLanguage.define(toml);
  if (extension === "sql") return StreamLanguage.define(standardSQL);
  if (extension === "diff" || extension === "patch") return StreamLanguage.define(diff);
  if (extension === "ini" || extension === "conf" || extension === "cfg" || extension === "properties") return StreamLanguage.define(properties);
  return [];
}
