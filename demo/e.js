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
const componentModules = new Map();

export const ejs = {
  // Each component file is an optional <script> (an ES module whose default
  // export runs on mount), raw template markup, and optional <style> blocks;
  // the template is registered under the file's basename. Script and style
  // are extracted at the string level, so the markup is never parsed as DOM
  // and EJS tags survive intact anywhere.
  async loadComponents(...urls) {
    await Promise.all(urls.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load component from ${url}: ${response.status}`);
      }

      const name = new URL(url, document.baseURI).pathname
        .split('/').pop().replace(/\.html$/, '');

      const scripts = [];
      const source = (await response.text())
        .replace(/<script>([\s\S]*?)<\/script>/g, (_, code) => {
          scripts.push(code);
          return '';
        })
        .replace(/<style[\s\S]*?<\/style>/g, (styleTag) => {
          document.head.insertAdjacentHTML('beforeend', styleTag);
          return '';
        });

      namedTemplates.set(name, source.trim());

      if (scripts.length) {
        const moduleUrl = `data:text/javascript,${encodeURIComponent(scripts.join('\n'))}`;
        componentModules.set(name, await import(moduleUrl));
      }
    }));
  },

  async mount(name, el, props) {
    el.innerHTML = this.fromNamedTemplate(name, props);
    return componentModules.get(name)?.default?.(el, props);
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
