FROM python:3.11-slim

RUN apt-get update && apt-get install -y curl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY main.py .
COPY requirements.txt .

RUN pip install uv && \
    uv pip install --system --no-cache -r requirements.txt

EXPOSE 8003

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8003"]