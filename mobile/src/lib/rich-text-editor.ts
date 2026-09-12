import { DomUtils, parseDocument } from 'htmlparser2';

import { authoredContentSource } from './authored-content';

export type RichTextEditorCommand =
  | 'bold'
  | 'italic'
  | 'blockquote'
  | 'inlineCode'
  | 'codeBlock'
  | 'bulletList'
  | 'orderedList'
  | 'undo'
  | 'redo'
  | 'prepareLink'
  | 'setLink'
  | 'setFontSize';

export interface RichTextEditorState {
  bold: boolean;
  italic: boolean;
  link: boolean;
  blockquote: boolean;
  inlineCode: boolean;
  codeBlock: boolean;
  bulletList: boolean;
  orderedList: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export type RichTextEditorMessage =
  | { type: 'ready' }
  | { type: 'content'; html: string }
  | { type: 'height'; height: number }
  | { type: 'selection'; state: RichTextEditorState }
  | { type: 'link'; href: string };

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const BLOCKED_RICH_TEXT_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button',
  'textarea', 'select', 'option', 'link', 'meta', 'base', 'canvas', 'svg',
  'video', 'audio', 'source',
]);
const BLOCKED_RICH_TEXT_ATTRIBUTES = new Set(['style', 'contenteditable', 'srcset', 'ping', 'formaction', 'xlink:href']);

export function normalizedRichTextValue(value: string) {
  return sanitizeRichTextHtml(authoredContentSource(value).html);
}

/** Sanitizes stored HTML without silently converting untouched legacy Markdown. */
export function sanitizedStoredRichTextValue(value: string) {
  const source = authoredContentSource(value);
  return source.format === 'html' ? sanitizeRichTextHtml(source.html) : value.trim();
}

export function safeRichTextLink(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    return SAFE_LINK_PROTOCOLS.has(url.protocol) ? trimmed : null;
  } catch {
    return null;
  }
}

export function safeRichTextImage(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' && Boolean(url.hostname) ? trimmed : null;
  } catch {
    return null;
  }
}

export function richTextEditorFontSize(fontScale: number) {
  return Math.round(16 * Math.max(1, fontScale));
}

export function richTextHtmlHasVisibleContent(value: string) {
  const uncommented = value.replace(/<!--[\s\S]*?-->/g, '');
  if (/<(?:img|hr)\b/i.test(uncommented)) return true;
  return uncommented
    .replace(/<[^>]*>/g, '')
    .replace(/(?:&nbsp;|&#160;|&#x0*a0;)/gi, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim().length > 0;
}

export function sanitizeRichTextHtml(value: string) {
  const parsed = parseDocument(value);
  const sanitizeNodes = (nodes: typeof parsed.children) => {
    nodes.slice().forEach((node) => {
      if (node.type === 'comment') {
        DomUtils.removeElement(node);
        return;
      }
      if (!DomUtils.isTag(node)) return;
      const tagName = node.name.toLowerCase();
      if (BLOCKED_RICH_TEXT_TAGS.has(tagName)) {
        DomUtils.removeElement(node);
        return;
      }
      Object.keys(node.attribs).forEach((attributeName) => {
        const name = attributeName.toLowerCase();
        if (name.startsWith('on') || BLOCKED_RICH_TEXT_ATTRIBUTES.has(name)) delete node.attribs[attributeName];
      });
      if (tagName === 'a') {
        const href = safeRichTextLink(node.attribs.href || '');
        if (href) node.attribs.href = href;
        else delete node.attribs.href;
        delete node.attribs.target;
      } else {
        delete node.attribs.href;
      }
      if (tagName === 'img') {
        const src = safeRichTextImage(node.attribs.src || '');
        if (src) node.attribs.src = src;
        else {
          DomUtils.removeElement(node);
          return;
        }
      } else {
        delete node.attribs.src;
      }
      sanitizeNodes(node.children);
    });
  };
  sanitizeNodes(parsed.children);
  return parsed.children.map((node) => DomUtils.getOuterHTML(node)).join('');
}

export function parseRichTextEditorMessage(value: string): RichTextEditorMessage | null {
  try {
    const message = JSON.parse(value) as Record<string, unknown>;
    if (message.type === 'ready') return { type: 'ready' };
    if (message.type === 'content' && typeof message.html === 'string') return { type: 'content', html: message.html };
    if (message.type === 'height' && typeof message.height === 'number' && Number.isFinite(message.height)) return { type: 'height', height: message.height };
    if (message.type === 'link' && typeof message.href === 'string') return { type: 'link', href: message.href };
    if (message.type === 'selection' && isEditorState(message.state)) return { type: 'selection', state: message.state };
    return null;
  } catch {
    return null;
  }
}

export function richTextEditorCommandScript(command: RichTextEditorCommand, value?: string) {
  return `window.CSGEditor && window.CSGEditor.command(${safeJson(command)}, ${safeJson(value || '')}); true;`;
}

export function richTextEditorContentScript(value: string) {
  return `window.CSGEditor && window.CSGEditor.setContent(${safeJson(normalizedRichTextValue(value))}); true;`;
}

export function richTextEditorDocument(value: string, placeholder: string, fontScale = 1) {
  const initialHtml = safeJson(normalizedRichTextValue(value));
  const safePlaceholder = escapeHtml(placeholder);
  const editorFontSize = richTextEditorFontSize(fontScale);
  const blockedSelector = safeJson(Array.from(BLOCKED_RICH_TEXT_TAGS).join(','));
  const blockedAttributes = JSON.stringify(Array.from(BLOCKED_RICH_TEXT_ATTRIBUTES));

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #12151D; color: #D6D9E1; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: ${editorFontSize}px; line-height: 1.55; }
    body { min-height: 206px; }
    #editor { min-height: 206px; padding: 14px; outline: none; overflow-wrap: anywhere; }
    #editor:empty::before { content: attr(data-placeholder); color: #626B7F; pointer-events: none; }
    p { margin: 0 0 12px; }
    h1, h2, h3 { color: #F3F4F6; margin: 16px 0 8px; line-height: 1.3; }
    h1 { font-size: 24px; } h2 { font-size: 20px; } h3 { font-size: 17px; }
    strong, b { color: #F3F4F6; }
    a { color: #F0445B; text-decoration: underline; }
    ul, ol { margin: 0 0 12px; padding-left: 24px; }
    li { margin-bottom: 5px; }
    blockquote { margin: 12px 0; padding: 9px 12px; border-left: 3px solid #C51D34; background: #211319; }
    code { padding: 2px 4px; border-radius: 4px; background: #20151A; color: #F5A3AF; font-family: ui-monospace, Menlo, monospace; font-size: 14px; }
    pre { margin: 12px 0; padding: 12px; border: 1px solid #252A36; border-radius: 10px; background: #080A0E; white-space: pre-wrap; overflow-wrap: normal; }
    pre code { padding: 0; background: transparent; color: #E5E7EB; }
    img { max-width: 100%; height: auto; border-radius: 10px; }
  </style>
</head>
<body>
  <div id="editor" contenteditable="true" role="textbox" aria-label="Exercise instructions" aria-multiline="true" data-placeholder="${safePlaceholder}"></div>
  <script>
    (() => {
      const editor = document.getElementById('editor');
      const blockedSelector = ${blockedSelector};
      const blockedAttributes = new Set(${blockedAttributes});
      let savedRange = null;
      let lastHeight = 0;
      let contentTimer = null;

      const post = (payload) => window.ReactNativeWebView?.postMessage(JSON.stringify(payload));
      const safeUrl = (value, allowMail = false) => {
        try {
          const parsed = new URL(value);
          if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return value;
          if (allowMail && parsed.protocol === 'mailto:') return value;
        } catch {}
        return '';
      };
      const safeImageUrl = (value) => {
        try {
          const parsed = new URL(value);
          return parsed.protocol === 'https:' && parsed.hostname ? value : '';
        } catch {}
        return '';
      };
      const clean = (html) => {
        const template = document.createElement('template');
        template.innerHTML = html || '';
        template.content.querySelectorAll(blockedSelector).forEach((node) => node.remove());
        template.content.querySelectorAll('*').forEach((node) => {
          Array.from(node.attributes).forEach((attribute) => {
            const name = attribute.name.toLowerCase();
            if (name.startsWith('on') || blockedAttributes.has(name)) node.removeAttribute(attribute.name);
          });
          if (node.tagName === 'A') {
            const href = safeUrl(node.getAttribute('href') || '', true);
            if (href) node.setAttribute('href', href); else node.removeAttribute('href');
            node.removeAttribute('target');
          } else if (node.hasAttribute('href')) node.removeAttribute('href');
          if (node.tagName === 'IMG') {
            const src = safeImageUrl(node.getAttribute('src') || '');
            if (src) node.setAttribute('src', src); else node.remove();
          } else if (node.hasAttribute('src')) node.removeAttribute('src');
        });
        return template.innerHTML;
      };
      const normalizedContent = () => {
        const html = clean(editor.innerHTML).trim();
        const template = document.createElement('template');
        template.innerHTML = html;
        const visibleText = (template.content.textContent || '').replace(/[\u00a0\u200B-\u200D\uFEFF]/g, '').trim();
        const meaningfulMedia = template.content.querySelector('img,hr');
        return visibleText || meaningfulMedia ? html : '';
      };
      const notifyHeight = () => {
        const height = Math.max(220, Math.ceil(editor.scrollHeight));
        if (height !== lastHeight) { lastHeight = height; post({ type: 'height', height }); }
      };
      const selectionState = () => {
        const selection = window.getSelection();
        let node = selection?.anchorNode || null;
        if (node?.nodeType === Node.TEXT_NODE) node = node.parentNode;
        const closest = (tag) => node instanceof Element && Boolean(node.closest(tag));
        post({ type: 'selection', state: {
          bold: document.queryCommandState('bold'),
          italic: document.queryCommandState('italic'),
          link: closest('a'),
          blockquote: closest('blockquote'),
          inlineCode: closest('code') && !closest('pre'),
          codeBlock: closest('pre'),
          bulletList: closest('ul'),
          orderedList: closest('ol'),
          canUndo: document.queryCommandEnabled('undo'),
          canRedo: document.queryCommandEnabled('redo'),
        }});
      };
      const emitContent = () => {
        clearTimeout(contentTimer);
        contentTimer = setTimeout(() => {
          post({ type: 'content', html: normalizedContent() });
          notifyHeight();
        }, 60);
      };
      const saveSelection = () => {
        const selection = window.getSelection();
        if (selection?.rangeCount) savedRange = selection.getRangeAt(0).cloneRange();
      };
      const restoreSelection = () => {
        if (!savedRange) return;
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(savedRange);
      };
      const toggleFormatBlock = (tag) => {
        const selection = window.getSelection();
        let node = selection?.anchorNode || null;
        if (node?.nodeType === Node.TEXT_NODE) node = node.parentNode;
        const active = node instanceof Element && node.closest(tag);
        document.execCommand('formatBlock', false, active ? 'p' : tag);
      };
      const toggleInlineCode = () => {
        const selection = window.getSelection();
        if (!selection?.rangeCount || selection.isCollapsed) return;
        const range = selection.getRangeAt(0);
        let node = range.commonAncestorContainer;
        if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
        const existing = node instanceof Element ? node.closest('code:not(pre code)') : null;
        if (existing) {
          existing.replaceWith(...existing.childNodes);
        } else {
          const code = document.createElement('code');
          try { range.surroundContents(code); } catch { document.execCommand('insertHTML', false, '<code>' + range.toString().replace(/[&<>]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[char])) + '</code>'); }
        }
      };

      window.CSGEditor = {
        setContent: (html) => {
          const cleanHtml = clean(html);
          if (cleanHtml !== editor.innerHTML) editor.innerHTML = cleanHtml;
          notifyHeight();
        },
        command: (command, value) => {
          editor.focus();
          if (command === 'prepareLink') {
            saveSelection();
            const selection = window.getSelection();
            let node = selection?.anchorNode || null;
            if (node?.nodeType === Node.TEXT_NODE) node = node.parentNode;
            post({ type: 'link', href: node instanceof Element ? node.closest('a')?.getAttribute('href') || '' : '' });
            return;
          }
          restoreSelection();
          if (command === 'setFontSize') {
            const fontSize = Number(value);
            if (Number.isFinite(fontSize) && fontSize >= 16) {
              document.documentElement.style.fontSize = fontSize + 'px';
              document.body.style.fontSize = fontSize + 'px';
              notifyHeight();
            }
            return;
          }
          if (command === 'bold' || command === 'italic' || command === 'undo' || command === 'redo') document.execCommand(command);
          if (command === 'bulletList') document.execCommand('insertUnorderedList');
          if (command === 'orderedList') document.execCommand('insertOrderedList');
          if (command === 'blockquote') toggleFormatBlock('blockquote');
          if (command === 'codeBlock') toggleFormatBlock('pre');
          if (command === 'inlineCode') toggleInlineCode();
          if (command === 'setLink') {
            const selection = window.getSelection();
            let node = selection?.anchorNode || null;
            if (node?.nodeType === Node.TEXT_NODE) node = node.parentNode;
            const existing = node instanceof Element ? node.closest('a') : null;
            const href = safeUrl(value || '', true);
            if (existing && href) existing.setAttribute('href', href);
            else if (existing) existing.replaceWith(...existing.childNodes);
            else if (href && selection?.isCollapsed) {
              const link = document.createElement('a');
              link.setAttribute('href', href);
              link.textContent = href;
              document.execCommand('insertHTML', false, link.outerHTML);
            } else if (href) document.execCommand('createLink', false, href);
            else document.execCommand('unlink');
          }
          saveSelection();
          emitContent();
          selectionState();
        },
      };

      editor.innerHTML = clean(${initialHtml});
      editor.addEventListener('input', emitContent);
      editor.addEventListener('keyup', () => { saveSelection(); selectionState(); });
      editor.addEventListener('mouseup', () => { saveSelection(); selectionState(); });
      editor.addEventListener('focus', () => { saveSelection(); selectionState(); });
      editor.addEventListener('click', (event) => { if (event.target.closest('a')) event.preventDefault(); });
      editor.addEventListener('drop', (event) => event.preventDefault());
      editor.addEventListener('paste', (event) => {
        event.preventDefault();
        const html = event.clipboardData?.getData('text/html');
        const text = event.clipboardData?.getData('text/plain') || '';
        if (html) document.execCommand('insertHTML', false, clean(html));
        else document.execCommand('insertText', false, text);
        emitContent();
      });
      new ResizeObserver(notifyHeight).observe(editor);
      notifyHeight();
      selectionState();
      post({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
}

function isEditorState(value: unknown): value is RichTextEditorState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  return ['bold', 'italic', 'link', 'blockquote', 'inlineCode', 'codeBlock', 'bulletList', 'orderedList', 'canUndo', 'canRedo']
    .every((key) => typeof state[key] === 'boolean');
}

function safeJson(value: string) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] || character);
}
