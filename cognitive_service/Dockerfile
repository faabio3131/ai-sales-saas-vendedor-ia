# Optional isolated cognitive runtime for staging/pilot; never publish directly.
FROM python:3.12-alpine
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN addgroup -S cognitive && adduser -S -G cognitive -u 10001 cognitive
COPY --chown=cognitive:cognitive cognitive_service /app/cognitive_service
USER 10001
EXPOSE 8185
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8185/health',timeout=2).close()" || exit 1
CMD ["python", "-m", "cognitive_service.server"]
