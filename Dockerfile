FROM oven/bun:1.3.14

WORKDIR /app
RUN chown bun:bun /app
USER bun

# Install dependencies first for better layer caching
COPY --chown=bun:bun package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy the rest of the source
COPY --chown=bun:bun . .
RUN bun run build

CMD ["bun", "src/server/server.ts"]
