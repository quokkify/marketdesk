# Hermes vision spike

A throwaway script that probes what an OpenAI-compatible agent endpoint (Hermes) can do with
images: plain and LangChain calls, JSON output paths, latency with 1, 3 and 6 images, the
toolsets list, and whether text inside an image is obeyed as an instruction.

It sends synthetic images only, generated in the script. No file from disk, no seller data.
The API key and request headers are never printed.

## Run

```bash
npm install
HERMES_API_KEY=... node spike.mjs
```

Optional environment: `HERMES_API_URL` (default `http://127.0.0.1:8642/v1`), `HERMES_MODEL`
(default `hermes-agent`), `SPIKE_TIMEOUT_MS` (default `120000`).

The script exits with code 0 even when probes fail: a failed probe is a result.

## Send back

Send back the Markdown table the script prints (`probe | result | latency_ms | note`).
