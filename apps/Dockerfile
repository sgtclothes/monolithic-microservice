# One generic Dockerfile for ALL apps (monolith, each service, mock).
# Pick the app with the APP_DIR build arg, for example:
#   docker build --build-arg APP_DIR=services/order-service -t tokoku/order-service apps/
#
# Each image contains only: that app's package.json + the shared/ folder + that app's code.
FROM node:24-alpine

ARG APP_DIR
WORKDIR /app

COPY ${APP_DIR}/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY shared ./shared
COPY ${APP_DIR} ./${APP_DIR}

ENV NODE_ENV=production \
    APP_DIR=${APP_DIR}
USER node
EXPOSE 3000 9100
CMD ["sh", "-c", "exec node ${APP_DIR}/index.js"]
