# MotionLint as an MCP stdio server.
#
# Based on the official Playwright image so Chromium and its system libraries are
# already present — MotionLint drives a real browser, so a bare node image would
# start and introspect fine but fail the moment a review or audit ran.
#
# The base tag is pinned to the Playwright version in package-lock.json. Bump both
# together: a mismatch means the bundled browser and the driver disagree.
FROM mcr.microsoft.com/playwright:v1.59.1-noble AS build

WORKDIR /app

# Dependencies first so this layer survives source-only edits.
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts

COPY src ./src
RUN npm run build

# ---

FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app

# --ignore-scripts skips the postinstall notice about installing Chromium; this
# image already ships it.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY .motionlintrc.json ./

ENV NODE_ENV=production

# Provider keys are optional — `motionlint audit` is deterministic and needs none.
# Pass ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY at run time to enable
# the vision-LLM review paths.
ENTRYPOINT ["node", "dist/index.js"]
CMD ["mcp"]
