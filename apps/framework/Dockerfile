FROM node:24.15.0-bookworm AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run docs:build
WORKDIR /app/apps/framework
ENV NODE_ENV=production DOCS_HOST=0.0.0.0 DOCS_PORT=8791
EXPOSE 8791
CMD ["npm", "start"]
