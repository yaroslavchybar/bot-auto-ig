FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
COPY convex/ /app/convex/

ARG VITE_CONVEX_URL
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL

ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

ARG VITE_DATAUPLOADER_URL
ENV VITE_DATAUPLOADER_URL=$VITE_DATAUPLOADER_URL

RUN npm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app/frontend

ENV NODE_ENV=production
ENV PORT=80

COPY --from=build /app/frontend/package.json ./package.json
COPY --from=build /app/frontend/package-lock.json ./package-lock.json
COPY --from=build /app/frontend/node_modules ./node_modules
COPY --from=build /app/frontend/build ./build

EXPOSE 80

CMD ["npm", "run", "start", "--", "--host", "0.0.0.0", "--port", "80"]
