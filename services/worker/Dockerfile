FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY . /app

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -e . \
    && pip install --no-cache-dir -e services/worker

CMD ["celery", "-A", "app.worker.celery_app", "worker", "-Q", "runs", "--loglevel=INFO"]
