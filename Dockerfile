FROM python:3.11-slim

# Install Node.js 20+ and curl  
RUN apt-get update && apt-get install -y curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install uv && \
    uv pip install --system --no-cache -r requirements.txt

# Copy and install Node.js dependencies
COPY package.json .
RUN npm install --omit=dev

# Copy application files
COPY . .

EXPOSE 8003

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8003"]
