FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY *.py ./
COPY keywords ./keywords

# Create non-root user and writable dirs
RUN useradd -m appuser \
    && mkdir -p /app/uploads \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 3002

CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "3002"]
