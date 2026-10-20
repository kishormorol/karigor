# Karigor, self-hosted: the chat UI and the whole kernel in one image.
# Projects live in the /data volume. Models: Ollama (default, free) or the Anthropic API (ANTHROPIC_API_KEY).
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates tar \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile && pnpm build

RUN mkdir -p /data && chown node:node /data
USER node
RUN git config --global user.name karigor && git config --global user.email karigor@localhost

ENV KARIGOR_ROOT=/data \
    KARIGOR_HOST=0.0.0.0 \
    PORT=4321 \
    KARIGOR_ADAPTER=ollama \
    KARIGOR_DEPLOY=local \
    OLLAMA_HOST=http://ollama:11434
VOLUME /data
EXPOSE 4321 3000
CMD ["node", "packages/server/dist/bin.js"]
