import { marked, Renderer } from 'marked';

import { safeExternalUrl } from './learning';

export function renderLessonMarkdown(body: string) {
  const renderer = new Renderer();
  renderer.html = ({ text }) => escapeHtml(text);
  renderer.link = function ({ href, tokens }) {
    const label = this.parser.parseInline(tokens);
    const safeHref = safeExternalUrl(href);
    return safeHref ? `<a href="${escapeHtml(safeHref)}">${label}</a>` : label;
  };
  renderer.image = ({ href, text }) => {
    const safeHref = safeExternalUrl(href);
    return safeHref ? `<img src="${escapeHtml(safeHref)}" alt="${escapeHtml(text)}">` : escapeHtml(text);
  };
  return marked.parse(body, { async: false, renderer }) as string;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] || character);
}
