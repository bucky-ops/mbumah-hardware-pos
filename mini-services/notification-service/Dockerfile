# MBUMAH HARDWARE POS - Realtime notification service (socket.io, port 3003)
#
# Runs the standalone socket.io server in mini-services/notification-service.
# Deployed by docker-compose.prod.yml as the `notification` service on the
# internal network; nginx routes the browser's same-origin /socket.io/
# traffic (websocket upgrade) to it. Never expose port 3003 to the host -
# the app trusts same-origin connections (CORS: *) and expects to sit
# behind the reverse proxy.
#
# Build:  docker build -t mbumah-notification mini-services/notification-service
# Run:    docker run -p 3003:3003 mbumah-notification   # host mapping for
#         local testing only; production goes through nginx

FROM oven/bun:1-slim

WORKDIR /app

# Install dependencies first (cached layer); the lockfile pins socket.io.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY index.ts .

EXPOSE 3003

CMD ["bun", "index.ts"]
