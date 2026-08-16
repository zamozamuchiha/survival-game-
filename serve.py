#!/usr/bin/env python3
"""Static dev server with cache-busted ES modules.

Two problems this solves:

1. `python -m http.server` sends Last-Modified and no Cache-Control, so browsers
   apply heuristic freshness and happily serve a stale module for minutes. You
   end up debugging code that isn't running.
2. No-cache headers alone are not enough. A nested import like `./core/rng.js`
   resolves relative to its importer with the query string dropped, so a version
   query on the entry point never reaches the rest of the graph.

So every relative import inside served JS gets rewritten with `?v=<mtime>` of
the file it points at. Edit a file and its URL changes, which changes its
importers' contents, which changes theirs — the whole graph invalidates itself.
"""
import os
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# from './x.js'      import './x.js'      import('./x.js')
IMPORT_RE = re.compile(rb"""(from\s*|import\s*\(?\s*)(['"])(\.{1,2}/[^'"]+?\.js)(['"])""")

# <script src="./src/main.js">  — the entry point needs busting too, otherwise
# the browser serves a cached main.js that references the old versioned imports.
SCRIPT_RE = re.compile(rb"""(<script[^>]*\ssrc=)(['"])(\.{0,2}/?[^'"]+?\.js)(['"])""")


class DevHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

    def send_header(self, key, value):
        # Drop validators so the browser can never revalidate into a 304.
        if key.lower() in ('last-modified', 'etag'):
            return
        super().send_header(key, value)

    def _stamp(self, pattern, body, url_path):
        base_dir = os.path.dirname(self.translate_path(url_path))

        def sub(m):
            prefix, q1, spec, q2 = m.groups()
            target = os.path.normpath(os.path.join(base_dir, spec.decode().lstrip('/')))
            try:
                v = int(os.path.getmtime(target))
            except OSError:
                return m.group(0)
            return b'%s%s%s?v=%d%s' % (prefix, q1, spec, v, q2)

        return pattern.sub(sub, body)

    def send_head(self):
        url_path = self.path.split('?', 1)[0]
        path = self.translate_path(url_path)
        if os.path.isdir(path):
            index = os.path.join(path, 'index.html')
            if os.path.isfile(index):
                path, url_path = index, url_path.rstrip('/') + '/index.html'

        if path.endswith('.js'):
            pattern, ctype = IMPORT_RE, 'text/javascript'
        elif path.endswith('.html'):
            pattern, ctype = SCRIPT_RE, 'text/html'
        else:
            return super().send_head()
        if not os.path.isfile(path):
            return super().send_head()

        with open(path, 'rb') as f:
            body = self._stamp(pattern, f.read(), url_path)

        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        return _Bytes(body)

    def log_message(self, fmt, *args):
        msg = fmt % args
        if '404' in msg:
            sys.stderr.write(msg + '\n')


class _Bytes:
    """Minimal file-like wrapper so send_head can return an in-memory body."""

    def __init__(self, data):
        self._data = data

    def read(self, *a):
        d, self._data = self._data, b''
        return d

    def close(self):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    root = sys.argv[2] if len(sys.argv) > 2 else '.'
    print(f'serving {root} on http://localhost:{port} (no-cache, versioned imports)', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), partial(DevHandler, directory=root)).serve_forever()
