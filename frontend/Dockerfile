FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/src ./src
COPY frontend/public ./public
COPY frontend/angular.json frontend/tsconfig.json frontend/tsconfig.app.json frontend/tsconfig.spec.json ./
RUN npm run build && ls -la dist/cukiernia-online/browser/

FROM nginx:1.27-alpine
COPY --from=build /app/dist/cukiernia-online/browser/ /usr/share/nginx/html/
RUN rm -f /usr/share/nginx/html/index.html && \
    cp /usr/share/nginx/html/index.csr.html /usr/share/nginx/html/index.html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
