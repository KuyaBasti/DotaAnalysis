.PHONY: help install test test-pipeline test-api test-web sim calibrate api web

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  %-14s %s\n", $$1, $$2}'

install: ## Install pipeline (editable) + api/web deps
	pip install -e pipeline
	cd api && npm install
	cd web && npm install

test: test-pipeline test-api test-web ## Run all test suites

test-pipeline: ## Python engine + pipeline tests
	PYTHONPATH=pipeline python -m pytest pipeline/tests/

test-api: ## API tests (vitest)
	cd api && npm test

test-web: ## Web tests (vitest) + typecheck
	cd web && npm run typecheck && npm test

sim: ## Simulate one match and export it for the viewer (SEED=42)
	python -m dm_pipeline.prototype.sim_loop --seed $(or $(SEED),42) --export

calibrate: ## Score the engine against the real corpus (N=2000)
	dm-calibrate --sample $(or $(N),2000)

api: ## Run the API dev server on :3000
	cd api && npm run dev

web: ## Run the web dev server on :5173 (needs the API running)
	cd web && npm run dev
