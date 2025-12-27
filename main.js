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
  // Use generic error handling in case CompressionStream is missing (old browsers)
  if (!window.CompressionStream) return null;
  
  const byteArray = new TextEncoder().encode(string);
  const stream = new CompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  writer.write(byteArray);
  writer.close();
  const buffer = await new Response(stream.readable).arrayBuffer();
  return toBase64Url(new Uint8Array(buffer));
}

async function decompress(b64) {
  if (!window.DecompressionStream) return null;
  
  try {
    const byteArray = fromBase64Url(b64);
    const stream = new DecompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    writer.write(byteArray);
    writer.close();
    const buffer = await new Response(stream.readable).arrayBuffer();
    return new TextDecoder().decode(buffer);
  } catch (err) {
    console.warn("Decompression failed:", err);
    return null;
  }
}

// --- App Logic ---

document.addEventListener('DOMContentLoaded', async () => {
  const errorDisplay = document.getElementById('error-display');
  window.onerror = (msg) => {
    errorDisplay.style.display = 'block';
    errorDisplay.textContent = 'Error: ' + msg;
  };

  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  // Initialize CodeMirror 5
  const editor = CodeMirror(document.getElementById("editor"), {
    mode: "markdown",
    theme: isDark ? "ayu-dark" : "neo",
    lineWrapping: true,
    autoCloseBrackets: true,
    styleActiveLine: true,
    indentUnit: 4,
    tabSize: 4,
    // NOTE: IME (e.g. Chinese/Japanese) can be flaky in some browsers with
    // CodeMirror 5's contenteditable input. Prefer textarea for stability.
    inputStyle: "textarea",
    spellcheck: true
  });

  // Theme auto-switching
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener('change', e => {
    const newIsDark = e.matches;
    editor.setOption("theme", newIsDark ? "ayu-dark" : "neo");
    document.body.style.backgroundColor = newIsDark ? "#0b0e14" : "#ffffff";
  });

  // State Management
  let saveTimer = null;
  let isComposing = false;

  function scheduleUpdateState() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(updateState, 500);
  }

  // Avoid doing expensive work / URL updates while the user is composing text via IME.
  // This reduces issues like unexpected "confirm" or duplicated lines during composition.
  const inputField = editor.getInputField();
  inputField.addEventListener('compositionstart', () => {
    isComposing = true;
    if (saveTimer) clearTimeout(saveTimer);
  });
  inputField.addEventListener('compositionend', () => {
    isComposing = false;
    scheduleUpdateState();
  });

  async function updateState() {
    const content = editor.getValue();
    
    // 1. Save to LocalStorage
    localStorage.setItem("markdown-content", content);
    
    // 2. Save to URL Hash
    if (content.trim().length > 0) {
      try {
        const hash = await compress(content);
        if (hash) {
            const nextHash = "#" + hash;
            if (location.hash !== nextHash) {
              window.history.replaceState(null, null, nextHash);
            }
        }
      } catch (e) {
        console.error("Compression error", e);
      }
    } else {
      if (location.hash) {
        window.history.replaceState(null, null, location.pathname);
      }
    }

    // 3. Update Title
    const firstLine = content.split('\n')[0].trim();
    if (firstLine.startsWith('# ')) {
        document.title = firstLine.substring(2);
    } else if (firstLine.length > 0 && firstLine.length < 50) {
        document.title = firstLine;
    } else {
        document.title = "Markdown Editor";
    }
  }

  editor.on("change", (_cm, changeObj) => {
    // CodeMirror marks composition changes as "*compose" in some browsers.
    if (isComposing || changeObj?.origin === "*compose") return;
    scheduleUpdateState();
  });

  // Hash Navigation Handler
  window.addEventListener('hashchange', async () => {
    if (location.hash.length > 1) {
        const urlContent = await decompress(location.hash.slice(1));
        if (urlContent !== null && urlContent !== editor.getValue()) {
            // Prevent triggering change event loop if possible, or just accept the update
            const cursor = editor.getCursor();
            editor.setValue(urlContent);
            editor.setCursor(cursor);
        }
    }
  });

  // Initial Content Load
  let initialContent = "# Hello World\n\nStart writing in Markdown...";
  
  // 1. URL Hash
  if (location.hash.length > 1) {
    const dec = await decompress(location.hash.slice(1));
    if (dec !== null) initialContent = dec;
  } 
  // 2. LocalStorage
  else {
    const stored = localStorage.getItem("markdown-content");
    if (stored) initialContent = stored;
  }

  editor.setValue(initialContent);
  editor.clearHistory(); // Don't want to undo to empty state immediately
});
