						
.PHONY: build typecheck test docs site preview publish publish-dry-run

TSC := ./node_modules/.bin/tsc
TYPEDOC := ./node_modules/.bin/typedoc

build:
	$(TSC) -p tsconfig.json

typecheck:
	$(TSC) -p tsconfig.json --noEmit

test: build
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