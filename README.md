# Project Manager

A self-hosted, mobile-first project manager with an iOS-style interface. Organize projects with deadlines, nested tasks (up to three levels), web links, and cross-references between projects. Light and dark themes follow the system preference.

Built with Flask and vanilla JavaScript, no frontend framework, no database. Data lives in a single JSON file on the host.

## Run locally

Requires Docker with the Compose plugin.

```bash
./up.sh
```

Open <http://localhost:5000>. The script builds the image and starts the container in the background; it keeps running and restarts automatically until you stop it:

```bash
./down.sh
```

After changing any code, run `./up.sh` again: the app is baked into the image, so a rebuild is needed for changes to take effect.

### Useful commands

```bash
docker compose logs -f     # follow app logs
docker compose ps          # container status and health
```

## Data

All projects are stored in `app/data/projects.json`, bind-mounted into the container. The file stays on the host: it survives rebuilds and is not committed to Git. Back it up by copying that one file.

## Tests

```bash
python -m unittest discover tests
```

(Requires Flask installed locally, e.g. in a virtualenv: `pip install -r requirements.txt`.)

## Project structure

```
app/
  main.py               Flask app: REST API + page routes
  landing_page.html     Project list view
  project_view.html     Single project view (tasks, links)
  static/app-shell.css  Shared design system
  data/projects.json    Your data (host-owned, not in Git)
tests/                  API unit tests
Dockerfile, compose.yaml, up.sh, down.sh
```
