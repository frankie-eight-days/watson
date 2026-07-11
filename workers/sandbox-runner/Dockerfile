# Watson sandbox-runner container image.
# Base image ships Python 3.11 + Node.js 20 + common tools. The vending-bench
# fork runs on Node/tsx, which the base already provides; extra deps get added
# here as the run feature lands.
FROM docker.io/cloudflare/sandbox:0.7.0

# Ensure git is present for cloning the fork (base usually has it; be explicit).
RUN (command -v git >/dev/null 2>&1) || (apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*)

EXPOSE 8080
