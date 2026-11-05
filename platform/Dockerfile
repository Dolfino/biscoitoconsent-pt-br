FROM node:26-alpine AS build

WORKDIR /app/platform
COPY platform/package*.json ./
RUN npm ci

COPY platform ./
RUN npm run build && npm prune --omit=dev

FROM node:26-alpine

ENV NODE_ENV=production
WORKDIR /app/platform

COPY --from=build /app/platform/node_modules ./node_modules
COPY --from=build /app/platform/build ./build
COPY --from=build /app/platform/public ./public
COPY --from=build /app/platform/package.json ./package.json
COPY dist /app/dist

USER node
EXPOSE 3333
CMD ["npm", "start"]
