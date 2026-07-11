const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));

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

function parse(source) {
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

function compile(source) {
  const ast = parse(source);
  return (data) => renderNodes(ast, [data ?? {}]);
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
    return render(data);
  },

  fromNamedTemplate(name, data) {
    const source = namedTemplates.get(name);
    if (source == null) {
      throw new Error(`Missing template named ${name}`);
    }
    return this.render(source, data);
  },
};
