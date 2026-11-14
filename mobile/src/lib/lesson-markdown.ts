import { marked, Renderer } from 'marked';

import { safeExternalUrl } from './learning';

/**
 * `written`: text people type (updates, feedback, help replies), where a single
 * newline is a line break and headings start one level down (they sit under a
 * card title), matching the web renderer's written variant.
 */
export function renderLessonMarkdown(body: string, { written = false }: { written?: boolean } = {}) {
  const renderer = new Renderer();
  // Raw HTML shows as typed. An HTML block reads as a paragraph of that text.
  renderer.html = ({ text, block }) => {
    if (!block) return escapeHtml(text);
    const lines = escapeHtml(text.replace(/\n+$/, ''));
    return `<p>${written ? lines.replace(/\n/g, '<br>') : lines}</p>\n`;
  };
  if (written) {
    renderer.heading = function ({ tokens, depth }) {
      const level = Math.min(depth + 1, 6);
      return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`;
    };
  }
  renderer.link = function ({ href, tokens }) {
    const label = this.parser.parseInline(tokens);
    const safeHref = safeExternalUrl(href);
    return safeHref ? `<a href="${escapeHtml(safeHref)}">${label}</a>` : label;
  };
  renderer.image = ({ href, text }) => {
    const safeHref = safeExternalUrl(href);
    return safeHref ? `<img src="${escapeHtml(safeHref)}" alt="${escapeHtml(text)}">` : escapeHtml(text);
  };
  return marked.parse(body, { async: false, breaks: written, renderer }) as string;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] || character);
}
