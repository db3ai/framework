# Starter image for the k3s manifests in this folder. Build from the repository root:
#   docker build -f deploy/k3s/Dockerfile -t db3-starter:local .
FROM node:24.15.0-bookworm
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace db3-starter
WORKDIR /app/apps/starter
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
EXPOSE 3001
USER node
CMD ["npm", "start"]
