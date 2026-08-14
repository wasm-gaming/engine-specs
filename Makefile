						
.PHONY: build typecheck typecheck-tests test docs site preview publish publish-dry-run

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

test: build typecheck-tests
	node --test tests/*.test.mjs

publish: typecheck test
	npm publish --access public

publish-dry-run: typecheck test
	npm publish --access public --dry-run

# API reference → site/api-docs (config in typedoc.json)
docs:
	$(TYPEDOC)

# The whole Pages site: demo at the root, reference under /api-docs/
site: docs
	cp -R demo/. site/
	touch site/.nojekyll

preview: site
	python3 -m http.server 8020 --directory site