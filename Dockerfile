# Site (React + Vite) servido pelo nginx, que também repassa /api para a API.
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_SITE_URL
ARG VITE_API_URL=/api
ARG VITE_TURNSTILE_SITE_KEY=
ENV VITE_SITE_URL=$VITE_SITE_URL VITE_API_URL=$VITE_API_URL VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY
RUN npx vite build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
