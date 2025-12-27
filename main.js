import { EditorView, minimalSetup } from "https://esm.sh/codemirror@6.0.1";
import { EditorState, Compartment } from "https://esm.sh/@codemirror/state@6.4.0";
import { markdown, markdownLanguage } from "https://esm.sh/@codemirror/lang-markdown@6.2.0";
import { languages } from "https://esm.sh/@codemirror/language-data@6.3.1";
import { syntaxHighlighting, HighlightStyle, defaultHighlightStyle, bracketMatching } from "https://esm.sh/@codemirror/language@6.10.0";
import { tags } from "https://esm.sh/@lezer/highlight@1.2.0";
import { keymap, highlightActiveLine, drawSelection, dropCursor } from "https://esm.sh/@codemirror/view@6.23.0";
import { defaultKeymap, history, historyKeymap } from "https://esm.sh/@codemirror/commands@6.3.3";
import { searchKeymap, highlightSelectionMatches } from "https://esm.sh/@codemirror/search@6.5.5";
import { closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap } from "https://esm.sh/@codemirror/autocomplete@6.12.0";

// --- URL & Compression Logic (Adapted from Reference) ---

// Polyfills for base64url if needed, though we implement manually for cross-browser safety
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
  // Default to deflate-raw which is standard in CompressionStream
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
    padding: "20px 5vw"
  },
  ".cm-line": {
    padding: "2px 0" // bit of breathing room
  },
  "&.cm-focused": {
    outline: "none"
  }
});

const hybridHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.6em", fontWeight: "bold", class: "cm-heading-1" },
  { tag: tags.heading2, fontSize: "1.4em", fontWeight: "bold", class: "cm-heading-2" },
  { tag: tags.heading3, fontSize: "1.2em", fontWeight: "bold", class: "cm-heading-3" },
  { tag: tags.heading, fontWeight: "bold" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, textDecoration: "underline", opacity: "0.7" },
  { tag: tags.url, textDecoration: "underline", opacity: "0.5" },
  { tag: tags.quote, fontStyle: "italic", opacity: "0.8", borderLeft: "2px solid currentColor", paddingLeft: "10px" },
  { tag: tags.monospace, fontFamily: "monospace", padding: "2px 4px", borderRadius: "3px", backgroundColor: "rgba(128,128,128,0.1)" },
  { tag: tags.meta, opacity: "0.4" }, // Markdown characters like #, *, etc.
  { tag: tags.keyword, color: "#d73a49" }, // Syntax highlighting for code blocks
  { tag: tags.string, color: "#032f62" },
  { tag: tags.comment, color: "#6a737d", fontStyle: "italic" }
]);

// Color scheme handling
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
  
  // Debounce save
  if (window.saveTimer) clearTimeout(window.saveTimer);
  window.saveTimer = setTimeout(async () => {
    // Save to LocalStorage
    localStorage.setItem("markdown-content", content);
    
    // Save to URL Hash
    if (content.trim().length > 0) {
      const hash = await compress(content);
      history.replaceState(null, null, "#" + hash);
    } else {
      history.replaceState(null, null, location.pathname);
    }
    
    // Update Document Title based on first H1 or first line
    const firstLine = content.split('\n')[0].trim();
    if (firstLine.startsWith('# ')) {
        document.title = firstLine.substring(2);
    } else if (firstLine.length > 0) {
        document.title = firstLine;
    } else {
        document.title = "Markdown Editor";
    }
  }, 500);
};

// Initial Load
async function init() {
  let initialContent = "# Hello\n\nWrite something...";
  
  // Priority: URL Hash > LocalStorage > Default
  if (location.hash.length > 1) {
    const dec = await decompress(location.hash.slice(1));
    if (dec) initialContent = dec;
  } else {
    const stored = localStorage.getItem("markdown-content");
    if (stored) initialContent = stored;
  }

  // Detect dark mode
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  const startState = EditorState.create({
    doc: initialContent,
    extensions: [
      minimalSetup,
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      highlightActiveLine(),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      syntaxHighlighting(hybridHighlightStyle),
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
  
  // Listen for system theme changes
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener('change', e => {
    view.dispatch({
        effects: [
            // While we can't easily hot-swap the theme compartment without setup, reloading is safer for this MVP.
            // Ideally we use a Compartment for the theme.
        ]
    });
    // Simple reload to pick up theme change properly in this minimal version
    location.reload(); 
  });
  
  // Hash change listener (for back/forward navigation)
  window.addEventListener('hashchange', async () => {
    // Only reload content if it's different to prevent loops
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
