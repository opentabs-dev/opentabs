# Dockerfile for OpenTabs MCP Server
#
# Two-stage build: compiles from source, then creates a slim runtime image
# with all published plugins installed for MCP introspection (tools/list).
#
# Usage:
#   docker build -t opentabs .
#   docker run -p 9515:9515 opentabs

# --- Stage 1: Build ---
FROM node:22-alpine AS builder
RUN apk add --no-cache git
WORKDIR /build
COPY . .
RUN npm ci --ignore-scripts && npm run build

# --- Stage 2: Runtime ---
FROM node:22-alpine
RUN apk add --no-cache curl git

WORKDIR /app
COPY --from=builder /build/package.json /build/package-lock.json /app/
COPY --from=builder /build/platform /app/platform

# Install production deps and make CLI available globally
RUN npm ci --omit=dev --ignore-scripts && \
    ln -s /app/platform/cli/dist/cli.js /usr/local/bin/opentabs && \
    chmod +x /app/platform/cli/dist/cli.js

# Install all published plugins so their tools show up in introspection
RUN npm install -g $(curl -s "https://registry.npmjs.org/-/v1/search?text=keywords:opentabs-plugin&size=250" \
      | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const o=JSON.parse(d);console.log(o.objects.map(x=>x.package.name).filter(n=>n.includes('opentabs-plugin-')&&!n.includes('plugin-sdk')&&!n.includes('plugin-tools')).join(' '))})")

COPY glama.json ./

ENV HOST=0.0.0.0
ENV PORT=9515
EXPOSE 9515

ENTRYPOINT ["opentabs"]
CMD ["start", "--stdio"]
