						
.PHONY: build typecheck typecheck-tests typecheck-demo test docs site preview preview-stop publish publish-dry-run

PORT ?= 8020

TSC := ./node_modules/.bin/tsc
TYPEDOC := ./node_modules/.bin/typedoc

# `tsc` never removes output whose source is gone, so a deleted module would survive
# in dist/ and get published. Clean first, always.
build:
	rm -rf dist
	$(TSC) -p tsconfig.json

typecheck:
	$(TSC) -p tsconfig.json --noEmit

# The compile-time conformance suite: tests/types.test-d.ts and the reference engine.
# Passing tsc IS the assertion — there is nothing to run.
typecheck-tests:
	$(TSC) -p tests/tsconfig.json

# The demo is the second conformance proof: checkJs holds its engine to the same
# contract, so "the demo conforms" is verified rather than claimed.
typecheck-demo:
	$(TSC) -p demo/tsconfig.json

test: build typecheck-tests typecheck-demo
	node --test tests/*.test.mjs

publish: typecheck test
	npm publish --access public

publish-dry-run: typecheck test
	npm publish --access public --dry-run

# API reference → site/ (config in typedoc.json). Typedoc cleans its out dir, so it
# has to run before the demo is copied in, never after.
docs:
	$(TYPEDOC)

# The whole Pages site: reference at the root, demo under /demo/
#
# `site/src/` is not a stray copy of the sources. The demo imports the emitter from
# `../src/engine-specs.js` as a *value*, and a value import is not erased the way the
# JSDoc type imports next to it are: the browser really fetches that path. With the
# demo at `site/demo/`, it resolves to `site/src/`, so the built JS has to be there.
site: docs build
	mkdir -p site/demo site/src
	cp -R demo/. site/demo/
	rm -f site/demo/tsconfig.json
	cp dist/engine-specs.js site/src/engine-specs.js
	touch site/.nojekyll

# A previous preview left running holds the port, and python's own error for that is
# a traceback ending in `OSError: [Errno 48]`, which says nothing about what to do.
preview: site
	@lsof -nP -iTCP:$(PORT) -sTCP:LISTEN >/dev/null 2>&1 && { \
		echo "Port $(PORT) is already serving — a previous \`make preview\` is still running:"; \
		lsof -nP -iTCP:$(PORT) -sTCP:LISTEN | tail -n +2; \
		echo "Stop it with \`make preview-stop\`, or use \`make preview PORT=8021\`."; \
		exit 1; \
	} || true
	@echo "Reference: http://localhost:$(PORT)/    Demo: http://localhost:$(PORT)/demo/"
	python3 -m http.server $(PORT) --directory site

preview-stop:
	@pids=$$(lsof -ti TCP:$(PORT) -sTCP:LISTEN); \
	if [ -n "$$pids" ]; then \
		kill $$pids && echo "Stopped the server on port $(PORT) (pid $$pids)."; \
	else \
		echo "Nothing listening on port $(PORT)."; \
	fi