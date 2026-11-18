import { useEffect, useRef, type ReactNode } from "react";
import { toSafeMarkdownHtml } from "../../formatting/markdown";
import { writeClipboardText } from "../../clipboard";

/**
 * Markdown in the React transcript.
 *
 * The safe HTML comes from PI WEB's own renderer (`toSafeMarkdownHtml`): the
 * React tree does not run a markdown parser of its own, so a message is read the
 * same way in both shells and the sanitising rule lives in one place. What the
 * React layer adds is the code-block chrome — a copy control, a language label —
 * and a host element where a plugin's code-fence renderer can be mounted.
 */
export interface MarkdownProps {
  text: string;
  className?: string;
  testId?: string;
}

export function Markdown(props: MarkdownProps): ReactNode {
  const host = useRef<HTMLDivElement | null>(null);
  const html = toSafeMarkdownHtml(props.text);
  useEffect(() => {
    decorateCodeBlocks(host.current);
  }, [html]);
  return (
    <div
      className={props.className === undefined ? "piw-markdown" : `piw-markdown ${props.className}`}
      data-testid={props.testId}
      dangerouslySetInnerHTML={{ __html: html }}
      ref={host}
    />
  );
}

function decorateCodeBlocks(host: HTMLElement | null): void {
  if (host === null) return;
  for (const block of host.querySelectorAll("pre")) {
    if (block.parentElement?.dataset["piwDecorated"] === "true") continue;
    const code = block.querySelector("code");
    if (code === null) continue;
    const wrapper = document.createElement("div");
    wrapper.className = "piw-code-block";
    wrapper.dataset["piwDecorated"] = "true";
    block.replaceWith(wrapper);
    wrapper.append(block);

    const language = languageOf(code);
    const bar = document.createElement("div");
    bar.className = "piw-code-block__bar";
    const label = document.createElement("span");
    label.className = "piw-code-block__language";
    label.textContent = language;
    const copy = document.createElement("button");
    copy.className = "piw-code-block__copy";
    copy.type = "button";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => {
      void writeClipboardText(textOf(code)).then((written) => {
        copy.textContent = written ? "Copied" : "Copy failed";
        window.setTimeout(() => {
          copy.textContent = "Copy";
        }, 1600);
      });
    });
    bar.append(label, copy);
    wrapper.prepend(bar);
  }
}

function languageOf(code: Element): string {
  const match = /language-([\w-]+)/.exec(code.className);
  return match?.[1] ?? "text";
}

function textOf(code: Element): string {
  return code.textContent;
}
