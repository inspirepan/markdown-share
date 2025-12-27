import { EditorView, keymap, highlightActiveLine, drawSelection, dropCursor, lineNumbers, highlightSpecialChars } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting, HighlightStyle, bracketMatching, defaultHighlightStyle, indentOnInput } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { defaultKeymap, history as historyExtension, historyKeymap } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";

// --- URL & Compression Logic ---

function toBase64Url(u8) {
  const binary = String.fromCharCode(...u8);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(str) {
  const base64 = str
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const pad = base64.length % 4;
  const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function compress(string) {
  const byteArray = new TextEncoder().encode(string);
  const stream = new CompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  writer.write(byteArray);
  writer.close();
  const buffer = await new Response(stream.readable).arrayBuffer();
  return toBase64Url(new Uint8Array(buffer));
}

async function decompress(b64) {
  try {
    const byteArray = fromBase64Url(b64);
    const stream = new DecompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    writer.write(byteArray);
    writer.close();
    const buffer = await new Response(stream.readable).arrayBuffer();
    return new TextDecoder().decode(buffer);
  } catch (err) {
    console.warn("Decompression failed, maybe plain text?", err);
    return "";
  }
}

// --- Editor Theme (Hybrid Mode) ---

const hybridTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent"
  },
  ".cm-content": {
    caretColor: "currentColor",
    padding: "20px 5vw",
    maxWidth: "900px",
    margin: "0 auto"
  },
  ".cm-line": {
    padding: "2px 0"
  },
  "&.cm-focused": {
    outline: "none"
  }
});

const hybridHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "2.2em", fontWeight: "bold", lineHeight: "1.2", margin: "1em 0", class: "cm-heading-1" },
  { tag: tags.heading2, fontSize: "1.8em", fontWeight: "bold", lineHeight: "1.2", margin: "1em 0", class: "cm-heading-2" },
  { tag: tags.heading3, fontSize: "1.4em", fontWeight: "bold", lineHeight: "1.2", margin: "1em 0", class: "cm-heading-3" },
  { tag: tags.heading, fontWeight: "bold" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, textDecoration: "underline", opacity: "0.7" },
  { tag: tags.url, textDecoration: "underline", opacity: "0.5" },
  { tag: tags.quote, fontStyle: "italic", opacity: "0.8", borderLeft: "4px solid currentColor", paddingLeft: "10px", marginLeft: "0" },
  { tag: tags.monospace, fontFamily: "monospace", padding: "2px 4px", borderRadius: "3px", backgroundColor: "rgba(128,128,128,0.1)" },
  { tag: tags.meta, opacity: "0.4" },
  { tag: tags.keyword, color: "#d73a49" },
  { tag: tags.string, color: "#032f62" },
  { tag: tags.comment, color: "#6a737d", fontStyle: "italic" }
]);

const lightColors = EditorView.theme({
  "&": { color: "#24292e", backgroundColor: "#ffffff" },
  ".cm-content": { caretColor: "#24292e" },
  ".cm-cursor": { borderLeftColor: "#24292e" }
}, { dark: false });

const darkColors = EditorView.theme({
  "&": { color: "#c9d1d9", backgroundColor: "#0d1117" },
  ".cm-content": { caretColor: "#c9d1d9" },
  ".cm-cursor": { borderLeftColor: "#c9d1d9" },
  ".cm-activeLine": { backgroundColor: "#161b22" },
  ".cm-selectionMatch": { backgroundColor: "#3fb95040" }
}, { dark: true });

// --- App Logic ---

const updateDispatch = async (view) => {
  const content = view.state.doc.toString();
  
  if (window.saveTimer) clearTimeout(window.saveTimer);
  window.saveTimer = setTimeout(async () => {
    localStorage.setItem("markdown-content", content);
    
    if (content.trim().length > 0) {
      const hash = await compress(content);
      window.history.replaceState(null, null, "#" + hash);
    } else {
      window.history.replaceState(null, null, location.pathname);
    }
    
    const firstLine = content.split('\n')[0].trim();
    if (firstLine.startsWith('# ')) {
        document.title = firstLine.substring(2);
    } else if (firstLine.length > 0 && firstLine.length < 50) {
        document.title = firstLine;
    } else {
        document.title = "Markdown Editor";
    }
  }, 500);
};

async function init() {
  let initialContent = "# Hello\n\nStart typing here...";
  
  if (location.hash.length > 1) {
    const dec = await decompress(location.hash.slice(1));
    if (dec) initialContent = dec;
  } else {
    const stored = localStorage.getItem("markdown-content");
    if (stored) initialContent = stored;
  }

  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  // Manual setup instead of minimalSetup to ensure control over dependencies
  const startState = EditorState.create({
    doc: initialContent,
    extensions: [
      highlightSpecialChars(),
      historyExtension(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, {fallback: true}),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      hybridTheme,
      isDark ? darkColors : lightColors,
      EditorView.lineWrapping,
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...completionKeymap
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          updateDispatch(update.view);
        }
      })
    ]
  });

  const view = new EditorView({
    state: startState,
    parent: document.getElementById("editor")
  });
  
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener('change', e => {
    location.reload(); 
  });
  
  window.addEventListener('hashchange', async () => {
    if (location.hash.length > 1) {
        const urlContent = await decompress(location.hash.slice(1));
        if (urlContent && urlContent !== view.state.doc.toString()) {
            view.dispatch({
                changes: {from: 0, to: view.state.doc.length, insert: urlContent}
            });
        }
    }
  });
}

init();
