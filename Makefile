all: run
	@echo 'Listening on http://localhost:81'

down:
	docker compose down

run: build
	docker compose up --build -d && docker compose logs -f

build:
	docker compose build --parallel

logs:
	docker compose logs -f

watch:
	docker compose watch
