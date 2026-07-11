const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));

export const $ = (selector, el = document) => el.querySelector(selector);
export const $$ = (selector, el = document) => Array.from(el.querySelectorAll(selector));

// $create(tag, attrs): attrs are set as attributes, except className, which
// may be a string or an array of class names.
export const $create = (tag, attrs = {}) => {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'className') {
      el.className = Array.isArray(value) ? value.join(' ') : value;
    } else if (name === 'textContent') {
      el.textContent = value;
    } else if (name === 'children') {
      for (const child of value) {
        el.appendChild(child);
      }
    } else {
      el.setAttribute(name, value);
    }
  }
  return el;
};

// Templates compile to an AST rendered recursively, so no new Function/eval
// is needed (CSP-safe). The price: expressions must be dot paths (a.b.c), not
// arbitrary JS, and scriptlets are limited to `if (...) {`, `} else {`,
// `for (const x of list) {` and `}`.

const PATH = /^[\w$]+(?:\.[\w$]+)*$/;

function resolvePath(expr, scopes) {
  if (!PATH.test(expr)) {
    throw new Error(`Unsupported template expression "${expr}": only dot paths are allowed`);
  }

  const [head, ...rest] = expr.split('.');
  let value;
  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    if (head in Object(scopes[i])) {
      value = scopes[i][head];
      break;
    }
  }
  for (const key of rest) {
    if (value == null) {
      return undefined;
    }
    value = value[key];
  }
  return value;
}

function renderNodes(nodes, scopes) {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      out += node.value;
    } else if (node.type === 'interp') {
      const value = resolvePath(node.expr, scopes) ?? '';
      out += node.escape ? escapeHtml(value) : String(value);
    } else if (node.type === 'if') {
      out += renderNodes(resolvePath(node.test, scopes) ? node.consequent : node.alternate, scopes);
    } else {
      const list = resolvePath(node.list, scopes) ?? [];
      for (const item of list) {
        out += renderNodes(node.children, [...scopes, { [node.item]: item }]);
      }
    }
  }
  return out;
}

export function parseEJS(source) {
  const root = [];
  const stack = [{ children: root }];
  const top = () => stack[stack.length - 1];
  const tag = /<%([=\-]?)([\s\S]*?)%>/g;
  let cursor = 0;
  let match;

  while ((match = tag.exec(source))) {
    if (match.index > cursor) {
      top().children.push({ type: 'text', value: source.slice(cursor, match.index) });
    }
    cursor = match.index + match[0].length;

    const [, mode, raw] = match;
    const code = raw.trim();
    let m;

    if (mode) {
      top().children.push({ type: 'interp', expr: code, escape: mode === '=' });
    } else if ((m = code.match(/^if\s*\(([\s\S]+)\)\s*\{$/))) {
      const node = { type: 'if', test: m[1].trim(), consequent: [], alternate: [] };
      top().children.push(node);
      stack.push({ node, children: node.consequent });
    } else if (code === '} else {') {
      const frame = top();
      if (frame.node?.type !== 'if') {
        throw new Error('Unexpected "} else {" in template');
      }
      frame.children = frame.node.alternate;
    } else if ((m = code.match(/^for\s*\(\s*(?:const|let|var)\s+([\w$]+)\s+of\s+([\s\S]+?)\s*\)\s*\{$/))) {
      const node = { type: 'each', item: m[1], list: m[2], children: [] };
      top().children.push(node);
      stack.push({ node, children: node.children });
    } else if (code === '}') {
      if (stack.length === 1) {
        throw new Error('Unbalanced "}" in template');
      }
      stack.pop();
    } else {
      throw new Error(`Unsupported template scriptlet "<% ${code} %>"`);
    }
  }

  if (stack.length !== 1) {
    throw new Error('Unclosed block in template');
  }
  if (cursor < source.length) {
    root.push({ type: 'text', value: source.slice(cursor) });
  }
  return root;
}

export function renderEJS(ast, data) {
  return renderNodes(ast, [data ?? {}]);
}

// Extracts every <script type="text/html" name="..."> from an HTML string and
// returns { [name]: ast }. String-level extraction: the templates are never
// parsed as DOM, so EJS tags survive intact anywhere.
export function loadTemplates(html) {
  const templates = {};
  const re = /<script\s[^>]*type="text\/html"[^>]*>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = re.exec(html))) {
    const name = match[0].match(/\sname="([^"]+)"/)?.[1];
    if (name) {
      templates[name] = parseEJS(match[1].trim());
    }
  }
  return templates;
}

// <style> blocks support EJS tags too, but interpolations emit raw values:
// HTML entity escaping would corrupt CSS, so `<%= %>` and `<%- %>` behave
// identically there.
const rawify = (nodes) => {
  for (const node of nodes) {
    if (node.type === 'interp') {
      node.escape = false;
    } else if (node.type === 'if') {
      rawify(node.consequent);
      rawify(node.alternate);
    } else if (node.type === 'each') {
      rawify(node.children);
    }
  }
  return nodes;
};

const isStatic = (nodes) => nodes.every((node) => node.type === 'text');

// A component file is an optional <script> (its default export, or its body
// when a :fn="{ destructured, args }" attribute declares the signature), raw
// template markup, and optional <style> blocks. Template and styles are EJS;
// the script is plain JS — it receives the live data at run time, so it needs
// no templating (and re-importing rendered module sources would leak modules).
//
// mount(el, props) / mountShadow(el, props) render into el (or its shadow
// root) once and return an instance:
//   destroy() — run the script's cleanup and remove rendered DOM/styles;
//               idempotent.
//   api       — whatever the script returned; its optional `destroy()` is
//               the cleanup hook invoked on destroy.
// There is deliberately no update(): re-rendering would drop DOM state and
// re-run the script, orphaning its timers/listeners/requests. To change what
// is shown, expose helpers on the script's api — or destroy() and mount
// again with the new props, which is the same work made explicit.
// Static CSS is shared across instances (one global <style> for mount, one
// adopted stylesheet for mountShadow); CSS with EJS tags is rendered once
// per instance.
export async function parseComponent(source) {
  let script = null;
  const styles = [];

  const markup = source
    .replace(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g, (_, attrs, code) => {
      script = { code, signature: attrs?.match(/:fn\s*=\s*"([^"]*)"/)?.[1] ?? null };
      return '';
    })
    .replace(/<style[^>]*>([\s\S]*?)<\/style>/g, (_, css) => {
      styles.push(css);
      return '';
    });

  const ast = parseEJS(markup.trim());
  const cssAst = rawify(parseEJS(styles.join('\n')));
  const staticCss = isStatic(cssAst);

  let fn = null;
  if (script) {
    const moduleSource = script.signature
      ? `export default ($el, $props) => {\nconst ${script.signature} = { el: $el, ...$props };\n${script.code}\n};`
      : script.code;
    fn = (await import(`data:text/javascript,${encodeURIComponent(moduleSource)}`)).default;
  }

  let globalStyleInjected = false;
  let sharedSheet = null;

  // mount and mountShadow share the CSS lifecycle — no CSS, static CSS
  // (rendered once, shared by every instance), or dynamic CSS (rendered per
  // instance) — and differ only in the medium. `shared`/`own` install the
  // artifact and return its remover (null when nothing per-instance remains).
  const makeStyler = (shared, own) => (data) => {
    if (!cssAst.length) {
      return null;
    }
    return (staticCss ? shared : own)(renderEJS(cssAst, data));
  };

  const headStyle = (textContent) => {
    return document.head
      .appendChild($create('style', { textContent }));
  };

  const adoptSheet = (root, sheet) => {
    root.adoptedStyleSheets = [sheet];
    return () => {
      root.adoptedStyleSheets = [];
    };
  };

  const createInstance = async (root, props, styler) => {
    const data = { ...props };

    const dropCss = styler(data);
    root.innerHTML = renderEJS(ast, data);
    let api = (await fn?.(root, {
      $, $$, $create,
      ...data,
    })) ?? null;
    let alive = true;

    return {
      root,
      data,
      get api() {
        return api;
      },
      destroy() {
        if (!alive) {
          return;
        }
        alive = false;
        api?.destroy?.();
        api = null;
        root.innerHTML = '';
        dropCss?.();
      },
    };
  };

  return {
    ast,
    cssAst,
    fn,

    async mount(el, props) {
      return createInstance(el, props, makeStyler(
        (css) => {
          if (globalStyleInjected) return null;
          // the shared <style> outlives instances
          globalStyleInjected = true;
          headStyle(css);
        },
        (css) => {
          const styleEl = headStyle(css);
          return () => styleEl.remove();
        },
      ));
    },

    // Like mount, but renders into el's shadow root: the component's CSS is
    // scoped to the shadow tree instead of injected globally, and the script
    // receives the shadow root as `el`.
    async mountShadow(el, props) {
      const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
      return createInstance(root, props, makeStyler(
        (css) => {
          if (!sharedSheet) {
            sharedSheet = new CSSStyleSheet();
            sharedSheet.replaceSync(css);
          }
          return adoptSheet(root, sharedSheet);
        },
        (css) => {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(css);
          return adoptSheet(root, sheet);
        },
      ));
    },
  };
}

export async function fetchEJS(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch component from ${url}: ${response.status}`);
  }
  return parseComponent(await response.text());
}
