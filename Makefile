.PHONY: help install run dev lint lint-fix format format-check check docker-build docker-up docker-down docker-logs docker-restart clean

help:
	@echo "make install        install dependencies"
	@echo "make run            start the server (npm start)"
	@echo "make dev            start with auto-restart on file changes"
	@echo "make lint           eslint"
	@echo "make lint-fix       eslint --fix"
	@echo "make format         prettier --write"
	@echo "make format-check   prettier --check"
	@echo "make check          lint + format-check"
	@echo "make docker-build   build the Docker image"
	@echo "make docker-up      run via docker compose (foreground)"
	@echo "make docker-down    stop docker compose"
	@echo "make docker-logs    tail docker compose logs"
	@echo "make docker-restart docker-down + docker-up"
	@echo "make clean          remove node_modules"

install:
	npm install

run:
	npm start

dev:
	node --watch server.js

lint:
	npm run lint

lint-fix:
	npm run lint:fix

format:
	npm run format

format-check:
	npm run format:check

check: lint format-check

docker-build:
	docker compose build

docker-up:
	docker compose up --build

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

docker-restart: docker-down docker-up

clean:
	rm -rf node_modules
