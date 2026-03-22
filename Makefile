# SimHammer Makefile

COMPOSE_DEV = docker-compose.dev.yml

.PHONY: help serve stop rebuild logs clean build-standalone run-standalone

help:
	@echo "SimHammer Development Commands:"
	@echo "  make serve            - Start the development environment (Docker)"
	@echo "  make stop             - Stop the development environment"
	@echo "  make rebuild          - Rebuild containers and start"
	@echo "  make logs             - Show real-time logs from all containers"
	@echo "  make clean            - Stop environment and remove all volumes (reset database)"
	@echo "  make build-standalone - Build a single standalone Docker image covering both frontend and backend"
	@echo "  make run-standalone   - Run the standalone Docker image with persistent volumes"

serve:
	docker compose -f $(COMPOSE_DEV) up

stop:
	docker compose -f $(COMPOSE_DEV) down

rebuild:
	docker compose -f $(COMPOSE_DEV) up --build

logs:
	docker compose -f $(COMPOSE_DEV) logs -f

clean:
	docker compose -f $(COMPOSE_DEV) down -v

build-standalone:
	docker build -t simhammer-standalone -f Dockerfile.standalone .

run-standalone:
	docker run -it -p 8000:8000 \
		-v simhammer-data:/app/resources/data \
		-v simhammer-simc:/app/resources/simc_repo \
		-v simhammer-db:/app/db \
		simhammer-standalone
