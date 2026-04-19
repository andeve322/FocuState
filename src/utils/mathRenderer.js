import katex from 'katex';
import DOMPurify from 'dompurify';

// Render inline ($...$) and block ($$...$$) math in a source string to sanitized HTML.
export function renderMathToHtml(source) {
  if (!source) return '';

  // First handle block math $$...$$
  let html = source.replace(/\$\$([\s\S]+?)\$\$/g, (match, expr) => {
    try {
      return katex.renderToString(expr, { displayMode: true, throwOnError: false });
    } catch (err) {
      return `<pre class="katex-error">${escapeHtml(expr)}</pre>`;
    }
  });

  // Then inline $...$
  html = html.replace(/\$([^\$\n][^\$]*?)\$/g, (match, expr) => {
    try {
      return katex.renderToString(expr, { displayMode: false, throwOnError: false });
    } catch (err) {
      return `<code class="katex-error">${escapeHtml(expr)}</code>`;
    }
  });

  // Sanitize output
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
