import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toSafeMarkdownHtml } from "../formatting/markdown";
import { splitCodeFences, type MarkdownSegment } from "../formatting/codeFenceSegments";
import type { QualifiedCodeFenceRendererContribution } from "../plugins/types";
import { PluginReactSurface } from "./plugins/PluginReactSurface";

export interface ReactMarkdownProps {
  readonly text: string;
  /** The plugin that claims a fence language, if any. Absent on a host with no plugin runtime. */
  readonly findFenceRenderer?: (language: string) => QualifiedCodeFenceRendererContribution | undefined;
}

/**
 * A message's markdown, as the React transcript draws it.
 *
 * Markdown is sanitized into an HTML string, so the only moment a fenced block can be handed to a
 * plugin is before that happens: the text is split at its fences first, and every segment that is not
 * a claimed fence goes through the same sanitizer as always. A claimed fence is drawn by its plugin,
 * and the plain code block stands in while the plugin draws and after it fails — a diagram that
 * refuses is still the text the reader typed.
 */
export function ReactMarkdown({ text, findFenceRenderer }: ReactMarkdownProps) {
  const segments = useMemo(() => splitCodeFences(text), [text]);
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === "markdown") {
          return <div key={index} className="rw-markdown" dangerouslySetInnerHTML={{ __html: toSafeMarkdownHtml(segment.text) }} />;
        }
        const renderer = segment.language === undefined ? undefined : findFenceRenderer?.(segment.language);
        return <CodeFence key={index} segment={segment} renderer={renderer} />;
      })}
    </>
  );
}

function CodeFence({ segment, renderer }: { readonly segment: Extract<MarkdownSegment, { kind: "code" }>; readonly renderer: QualifiedCodeFenceRendererContribution | undefined }) {
  const plain = (
    <pre className="rw-markdown-code">
      <code className={segment.language === undefined ? undefined : `language-${segment.language}`}>{segment.text}</code>
    </pre>
  );
  if (renderer?.renderReact === undefined) return plain;
  return <PluginCodeFence renderer={renderer} source={segment.text} plain={plain} />;
}

function PluginCodeFence({ renderer, source, plain }: {
  readonly renderer: QualifiedCodeFenceRendererContribution;
  readonly source: string;
  readonly plain: ReactNode;
}) {
  const [drawn, setDrawn] = useState<unknown>(undefined);

  useEffect(() => {
    let current = true;
    setDrawn(undefined);
    const drawnSource = renderer.renderReact?.(source);
    if (drawnSource === undefined) return undefined;
    void Promise.resolve(drawnSource).then(
      (node) => { if (current) setDrawn(node); },
      () => { if (current) setDrawn(undefined); },
    );
    return () => { current = false; };
  }, [renderer, source]);

  if (drawn === undefined) return plain;
  return <PluginReactSurface contributionId={renderer.id} pluginLabel={renderer.pluginId} node={drawn} className="rw-markdown-fence" />;
}
