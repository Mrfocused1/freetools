FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    # HuggingFace cache — mounted as a volume in compose for persistence
    HF_HOME=/hf_cache

# System deps: freetype for PIL font rendering, git for build_index.py
RUN apt-get update -q && apt-get install -y --no-install-recommends \
    ca-certificates \
    libfreetype6-dev \
    libfontconfig1 \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install CPU-only PyTorch first (large, cache-friendly layer)
RUN pip install --no-cache-dir \
    torch==2.3.1 \
    --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py /app/main.py
# build_index.py is a one-time admin script — included so the user can run it
# inside the container:  docker compose run --rm font-worker python build_index.py
COPY build_index.py /app/build_index.py

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
