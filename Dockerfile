FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv/project-manager

COPY requirements.txt ./
RUN --mount=type=secret,id=host_ca \
    PIP_CERT=/run/secrets/host_ca \
    python -m pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN mkdir -p /srv/project-manager/app/data \
    && useradd --create-home --uid 1000 --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /srv/project-manager

USER appuser

EXPOSE 5000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5000/api/projects?summary=1', timeout=2)" || exit 1

CMD ["gunicorn", "--chdir", "app", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "4", "--timeout", "30", "--access-logfile", "-", "--error-logfile", "-", "main:app"]
