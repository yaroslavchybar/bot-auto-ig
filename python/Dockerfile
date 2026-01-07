FROM python:3.11-bookworm

WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY python/requirements.txt ./python/requirements.txt
RUN pip install --no-cache-dir -r python/requirements.txt \
  && python -m playwright install --with-deps firefox

COPY python ./python

CMD ["python", "-c", "print('anti python container ready')"]
