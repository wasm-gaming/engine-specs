						
.PHONY: build typecheck test publish publish-dry-run

TSC := ./node_modules/.bin/tsc

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

preview:
	python3 -m http.server 8020 --directory demo