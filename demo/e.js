const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));

function compile(source) {
  let body = "let out = '';\n";
  let cursor = 0;
  const tag = /<%([=\-]?)([\s\S]*?)%>/g;
  let match;

  while ((match = tag.exec(source))) {
    body += `out += ${JSON.stringify(source.slice(cursor, match.index))};\n`;
    const [, mode, code] = match;
    if (mode === '=') {
      body += `out += escapeHtml((${code}) ?? '');\n`;
    } else if (mode === '-') {
      body += `out += (${code}) ?? '';\n`;
    } else {
      body += `${code}\n`;
    }
    cursor = match.index + match[0].length;
  }

  body += `out += ${JSON.stringify(source.slice(cursor))};\nreturn out;`;
  const render = new Function('data', 'escapeHtml', `with (data) {\n${body}\n}`);

  // The proxy makes every identifier resolve through `with` (except the
  // renderer's own bindings), so templates can reference keys missing from
  // `data` and get undefined instead of a ReferenceError.
  const internals = new Set(['out', 'data', 'escapeHtml']);
  return (data, helpers) =>
    render(
      new Proxy(data ?? {}, {
        has: (target, key) => !internals.has(key),
        get: (target, key) => target[key],
      }),
      helpers,
    );
}

const cache = new Map();
const namedTemplates = new Map();

export const ejs = {
  // Each component file is <style> blocks plus raw template markup; the
  // template is registered under the file's basename. The markup is kept as
  // text (never parsed as DOM), so EJS tags survive intact anywhere.
  async loadTemplates(...urls) {
    await Promise.all(urls.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load template from ${url}: ${response.status}`);
      }

      const name = new URL(url, document.baseURI).pathname
        .split('/').pop().replace(/\.html$/, '');

      const source = (await response.text()).replace(/<style[\s\S]*?<\/style>/g, (styleTag) => {
        document.head.insertAdjacentHTML('beforeend', styleTag);
        return '';
      });

      namedTemplates.set(name, source.trim());
    }));
  },

  render(source, data) {
    let render = cache.get(source);
    if (!render) {
      render = compile(source);
      cache.set(source, render);
    }
    return render(data, escapeHtml);
  },

  fromNamedTemplate(name, data) {
    const source = namedTemplates.get(name);
    if (source == null) {
      throw new Error(`Missing template named ${name}`);
    }
    return this.render(source, data);
  },
};
