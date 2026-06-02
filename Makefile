SHELL := /bin/bash

CONFIG ?= $(or $(SPECTRAL_URBANISM_CONFIG),configs/city.yaml)
VENV ?= .venv
PYTHON ?= python3
PIP ?= $(VENV)/bin/pip

.PHONY: help setup install install-services doctor run-city run-api run-worker run-web local-dev local-dev-worker local-stop compose-up compose-down test

help:
	@echo "Targets:"
	@echo "  setup            Create venv and install core package"
	@echo "  install          Install core package into existing venv"
	@echo "  install-services Install API and worker editable packages"
	@echo "  doctor           Check local dev readiness"
	@echo "  run-city         Run generic city pipeline (CONFIG=...)"
	@echo "  run-api          Start FastAPI service"
	@echo "  run-worker       Start Celery worker"
	@echo "  run-web          Start Vite dev server"
	@echo "  local-dev        Start API (inline) + web (non-docker)"
	@echo "  local-dev-worker Start API + worker + web (requires Redis)"
	@echo "  local-stop       Stop services started by local-dev targets"
	@echo "  compose-up       Start full stack via Docker Compose"
	@echo "  compose-down     Stop full stack"
	@echo "  test             Run Python tests"

setup:
	$(PYTHON) -m venv $(VENV)
	$(PIP) install -U pip
	$(PIP) install -e .

install:
	$(PIP) install -U pip
	$(PIP) install -e .

install-services:
	$(PIP) install -e services/api
	$(PIP) install -e services/worker

doctor:
	bash scripts/doctor.sh

run-city:
	@if [ -x "$(VENV)/bin/spectral-urbanism" ]; then \
		$(VENV)/bin/spectral-urbanism run --config "$(CONFIG)"; \
	else \
		spectral-urbanism run --config "$(CONFIG)"; \
	fi

run-api:
	@if [ -x "$(VENV)/bin/uvicorn" ]; then \
		$(VENV)/bin/uvicorn app.main:app --app-dir services/api --reload --port 8000; \
	else \
		uvicorn app.main:app --app-dir services/api --reload --port 8000; \
	fi

run-worker:
	@if [ -x "$(VENV)/bin/celery" ]; then \
		$(VENV)/bin/celery -A app.worker.celery_app worker --workdir services/worker -Q runs --loglevel=INFO; \
	else \
		celery -A app.worker.celery_app worker --workdir services/worker -Q runs --loglevel=INFO; \
	fi

run-web:
	cd web && npm install && npm run dev

local-dev:
	bash scripts/dev.sh

local-dev-worker:
	DEV_WITH_WORKER=1 bash scripts/dev.sh

local-stop:
	bash scripts/dev-stop.sh

compose-up:
	docker compose --env-file .env up --build

compose-down:
	docker compose down

test:
	pytest
