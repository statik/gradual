FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock* bun.lockb* ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY drizzle ./drizzle
COPY public ./public
EXPOSE 3000
USER bun
CMD ["bun", "run", "src/index.ts"]
