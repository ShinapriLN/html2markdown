"use client";

import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import "katex/dist/katex.min.css";

// Tags from Gemini's Angular framework that carry no content value
const NOISE_TAGS = new Set([
  "response-element",
  "source-footnote",
  "sources-carousel-inline",
  "sources-carousel",
  "mat-icon",
  "sup",
  "button",
  "svg",
]);

// Tags that are just transparent wrappers
const WRAPPER_TAGS = new Set(["span", "div"]);

function htmlToMarkdown(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // If user pasted a full document, use body; otherwise use the parsed fragment
  const root = doc.body;

  return processNode(root).trim();
}

function processChildren(node: Node): string {
  let result = "";
  node.childNodes.forEach((child) => {
    result += processNode(child);
  });
  return result;
}

function processNode(node: Node): string {
  // Text nodes
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || "";
    // Collapse whitespace but preserve meaningful content
    return text.replace(/\s+/g, " ");
  }

  // Comments
  if (node.nodeType === Node.COMMENT_NODE) {
    return "";
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  // Skip noise tags entirely
  if (NOISE_TAGS.has(tag)) {
    return "";
  }

  // Check for hidden elements
  const style = el.getAttribute("style") || "";
  if (style.includes("display: none") || style.includes("visibility: hidden")) {
    return "";
  }

  // Skip elements with hide-from-message-actions class (Gemini UI elements)
  if (el.classList.contains("hide-from-message-actions")) {
    return "";
  }

  // --- LaTeX detection (BEFORE processing children) ---

  // Gemini uses <span class="math-inline" data-math="..."> and <span class="math-display" data-math="...">
  const dataMath = el.getAttribute("data-math");
  if (dataMath !== null && (el.classList.contains("math-inline") || el.classList.contains("math-display"))) {
    if (el.classList.contains("math-display")) {
      return `\n\n$$\n${dataMath}\n$$\n\n`;
    }
    return `$${dataMath}$`;
  }

  // KaTeX rendered containers — skip entirely (we already extracted from data-math above)
  if (el.classList.contains("katex") || el.classList.contains("katex-html") || el.classList.contains("katex-display")) {
    // If there's an annotation with the TeX source, use it as fallback
    const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
    if (annotation) {
      const tex = annotation.textContent || "";
      if (el.classList.contains("katex-display")) {
        return `\n\n$$\n${tex}\n$$\n\n`;
      }
      return `$${tex}$`;
    }
    // Otherwise skip — the parent math-inline/math-display already handled it
    return "";
  }

  // MathJax elements
  if (el.classList.contains("MathJax") || el.classList.contains("MathJax_Display")) {
    const script = el.querySelector('script[type="math/tex"], script[type="math/asciimath"]');
    if (script) {
      const tex = script.textContent || "";
      if (el.classList.contains("MathJax_Display") || script.getAttribute("type")?.includes("display")) {
        return `\n\n$$\n${tex}\n$$\n\n`;
      }
      return `$${tex}$`;
    }
  }

  // Skip KaTeX SVG images (the inline data:image/svg+xml used for square roots etc.)
  if (tag === "img" && el.classList.contains("katex-svg")) {
    return "";
  }

  const children = processChildren(el);

  // Wrapper tags: just pass through children
  if (WRAPPER_TAGS.has(tag) && !el.classList.contains("horizontal-scroll-wrapper")) {
    return children;
  }

  switch (tag) {
    // Headings
    case "h1":
      return `\n\n# ${children.trim()}\n\n`;
    case "h2":
      return `\n\n## ${children.trim()}\n\n`;
    case "h3":
      return `\n\n### ${children.trim()}\n\n`;
    case "h4":
      return `\n\n#### ${children.trim()}\n\n`;
    case "h5":
      return `\n\n##### ${children.trim()}\n\n`;
    case "h6":
      return `\n\n###### ${children.trim()}\n\n`;

    // Paragraphs
    case "p":
      return `\n\n${children.trim()}\n\n`;

    // Bold
    case "b":
    case "strong":
      return `**${children.trim()}**`;

    // Italic
    case "i":
    case "em":
      return `*${children.trim()}*`;

    // Code
    case "code": {
      const text = children.trim();
      if (text.includes("\n")) {
        return `\n\`\`\`\n${text}\n\`\`\`\n`;
      }
      return `\`${text}\``;
    }

    // Pre-formatted / code blocks
    case "pre": {
      const codeEl = el.querySelector("code");
      const lang = codeEl?.className?.match(/language-(\w+)/)?.[1] || "";
      const code = codeEl ? codeEl.textContent || "" : el.textContent || "";
      return `\n\n\`\`\`${lang}\n${code.trim()}\n\`\`\`\n\n`;
    }

    // Links
    case "a": {
      const href = el.getAttribute("href") || "";
      const text = children.trim();
      if (!href || href.startsWith("javascript:")) return text;
      return `[${text}](${href})`;
    }

    // Images
    case "img": {
      const src = el.getAttribute("src") || "";
      const alt = el.getAttribute("alt") || "";
      return `![${alt}](${src})`;
    }

    // Line breaks
    case "br":
      return "\n";

    // Horizontal rules
    case "hr":
      return "\n\n---\n\n";

    // Lists
    case "ul":
    case "ol":
      return `\n\n${processListItems(el, tag === "ol")}\n\n`;

    case "li": {
      // Usually handled by processListItems, but fallback
      return `- ${children.trim()}\n`;
    }

    // Tables
    case "table":
      return `\n\n${processTable(el)}\n\n`;

    // Blockquotes
    case "blockquote": {
      const lines = children.trim().split("\n");
      return `\n\n${lines.map((l) => `> ${l}`).join("\n")}\n\n`;
    }

    // Horizontal scroll wrapper (Gemini table wrapper)
    default:
      if (tag === "div" && el.classList.contains("horizontal-scroll-wrapper")) {
        return children;
      }
      return children;
  }
}

function processListItems(listEl: HTMLElement, ordered: boolean): string {
  const items: string[] = [];
  let index = 1;

  // Get the start attribute for ordered lists
  const startAttr = listEl.getAttribute("start");
  if (startAttr) {
    index = parseInt(startAttr, 10) || 1;
  }

  listEl.childNodes.forEach((child) => {
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const el = child as HTMLElement;
    if (el.tagName.toLowerCase() !== "li") return;

    const content = processChildren(el).trim();
    if (!content) return; // Skip empty list items

    if (ordered) {
      items.push(`${index}. ${content}`);
      index++;
    } else {
      items.push(`- ${content}`);
    }
  });

  return items.join("\n");
}

function processTable(tableEl: HTMLElement): string {
  const rows: string[][] = [];
  let headerRowCount = 0;

  // Process thead
  const thead = tableEl.querySelector("thead");
  if (thead) {
    thead.querySelectorAll("tr").forEach((tr) => {
      const cells: string[] = [];
      tr.querySelectorAll("td, th").forEach((cell) => {
        cells.push(processChildren(cell).trim().replace(/\|/g, "\\|"));
      });
      rows.push(cells);
      headerRowCount++;
    });
  }

  // Process tbody
  const tbody = tableEl.querySelector("tbody");
  if (tbody) {
    tbody.querySelectorAll("tr").forEach((tr) => {
      const cells: string[] = [];
      tr.querySelectorAll("td, th").forEach((cell) => {
        cells.push(processChildren(cell).trim().replace(/\|/g, "\\|"));
      });
      rows.push(cells);
    });
  }

  // If no thead/tbody, process rows directly
  if (rows.length === 0) {
    tableEl.querySelectorAll("tr").forEach((tr, i) => {
      const cells: string[] = [];
      tr.querySelectorAll("td, th").forEach((cell) => {
        cells.push(processChildren(cell).trim().replace(/\|/g, "\\|"));
      });
      rows.push(cells);
      if (i === 0) headerRowCount = 1;
    });
  }

  if (rows.length === 0) return "";

  // If no explicit header, treat first row as header
  if (headerRowCount === 0) headerRowCount = 1;

  const maxCols = Math.max(...rows.map((r) => r.length));

  // Normalize all rows to same column count
  const normalized = rows.map((r) => {
    while (r.length < maxCols) r.push("");
    return r;
  });

  const lines: string[] = [];

  // Header rows
  for (let i = 0; i < headerRowCount; i++) {
    lines.push(`| ${normalized[i].join(" | ")} |`);
  }

  // Separator
  const sep = normalized[0].map(() => "---");
  lines.push(`| ${sep.join(" | ")} |`);

  // Data rows
  for (let i = headerRowCount; i < normalized.length; i++) {
    lines.push(`| ${normalized[i].join(" | ")} |`);
  }

  return lines.join("\n");
}

function cleanupMarkdown(md: string): string {
  // Remove excessive blank lines (more than 2 consecutive newlines → 2)
  let result = md.replace(/\n{3,}/g, "\n\n");

  // Remove trailing spaces on lines
  result = result
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

  // Remove leading/trailing whitespace
  result = result.trim();

  return result;
}

export default function Home() {
  const [inputHtml, setInputHtml] = useState("");
  const [outputMd, setOutputMd] = useState("");
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<"preview" | "raw">("preview");

  const convert = useCallback(() => {
    if (!inputHtml.trim()) {
      setOutputMd("");
      return;
    }
    const raw = htmlToMarkdown(inputHtml);
    const cleaned = cleanupMarkdown(raw);
    setOutputMd(cleaned);
  }, [inputHtml]);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      // Try to get HTML from clipboard
      const htmlData = e.clipboardData.getData("text/html");
      if (htmlData) {
        e.preventDefault();
        setInputHtml(htmlData);
        // Auto-convert
        setTimeout(() => {
          const raw = htmlToMarkdown(htmlData);
          const cleaned = cleanupMarkdown(raw);
          setOutputMd(cleaned);
        }, 0);
      }
    },
    []
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(outputMd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: create a temporary textarea to copy
      const ta = document.createElement("textarea");
      ta.value = outputMd;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [outputMd]);

  const handleClear = useCallback(() => {
    setInputHtml("");
    setOutputMd("");
    setCopied(false);
  }, []);

  return (
    <div className="flex flex-col h-dvh bg-[#0a0a0f] text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800/60 bg-[#0d0d14]/80 backdrop-blur-xl shrink-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-sm font-bold">
              M
            </div>
            <h1 className="text-lg font-semibold tracking-tight">
              HTML → Markdown
            </h1>
          </div>
          <span className="text-xs text-zinc-500 hidden sm:block">
            Paste HTML • Convert • Copy Markdown + LaTeX
          </span>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 flex flex-col gap-4 min-h-0">
        {/* Two panels */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0">
          {/* Input panel */}
          <div className="flex flex-col rounded-xl border border-zinc-800/60 bg-[#111118] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/40 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400/80" />
                <span className="text-sm font-medium text-zinc-300">
                  Input HTML
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={convert}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 transition-colors"
                >
                  Convert
                </button>
                <button
                  onClick={handleClear}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>
            <textarea
              value={inputHtml}
              onChange={(e) => setInputHtml(e.target.value)}
              onPaste={handlePaste}
              placeholder="Paste your HTML here (Ctrl+V)&#10;&#10;Supports Gemini Deep Research, ChatGPT, and standard HTML with LaTeX..."
              className="flex-1 min-h-[300px] lg:min-h-0 bg-transparent px-4 py-3 text-sm font-mono text-zinc-300 placeholder:text-zinc-600 focus:outline-none resize-none"
              spellCheck={false}
            />
          </div>

          {/* Output panel */}
          <div className="flex flex-col rounded-xl border border-zinc-800/60 bg-[#111118] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/40 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-blue-400/80" />
                <div className="flex rounded-lg bg-zinc-800/60 p-0.5">
                  <button
                    onClick={() => setViewMode("preview")}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                      viewMode === "preview"
                        ? "bg-violet-600 text-white shadow-sm"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    Preview
                  </button>
                  <button
                    onClick={() => setViewMode("raw")}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                      viewMode === "raw"
                        ? "bg-violet-600 text-white shadow-sm"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    Raw
                  </button>
                </div>
              </div>
              <button
                onClick={handleCopy}
                disabled={!outputMd}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  copied
                    ? "bg-emerald-600 text-white"
                    : outputMd
                    ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white"
                    : "bg-zinc-800/50 text-zinc-600 cursor-not-allowed"
                }`}
              >
                {copied ? "✓ Copied!" : "Copy Markdown"}
              </button>
            </div>
            {viewMode === "preview" ? (
              <div className="flex-1 min-h-[300px] lg:min-h-0 overflow-auto px-5 py-4">
                {outputMd ? (
                  <article className="prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown
                      remarkPlugins={[remarkMath, remarkGfm]}
                      rehypePlugins={[rehypeKatex]}
                    >
                      {outputMd}
                    </ReactMarkdown>
                  </article>
                ) : (
                  <p className="text-sm text-zinc-600">
                    Converted preview will appear here...
                  </p>
                )}
              </div>
            ) : (
              <textarea
                value={outputMd}
                readOnly
                placeholder="Converted markdown will appear here..."
                className="flex-1 min-h-[300px] lg:min-h-0 bg-transparent px-4 py-3 text-sm font-mono text-zinc-300 placeholder:text-zinc-600 focus:outline-none resize-none"
                spellCheck={false}
              />
            )}
          </div>
        </div>

        {/* Info footer */}
        <div className="text-center text-xs text-zinc-600 py-2">
          Strips Gemini/Angular framework noise • Preserves headings, tables,
          lists, bold, links • Detects KaTeX & MathJax LaTeX
        </div>
      </main>
    </div>
  );
}
