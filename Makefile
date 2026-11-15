.PHONY: frontend-build backend-check backend-test backend-dev frontend-dev docker-up docker-down

frontend-build:
	cd frontend && npm install && npm run build

backend-check:
	cd backend && python -m compileall app

backend-test:
	cd backend && python -m pytest -q

backend-dev:
	cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

frontend-dev:
	cd frontend && npm run dev -- --host 0.0.0.0 --port 5174

docker-up:
	docker compose up -d --build

docker-down:
	docker compose down
