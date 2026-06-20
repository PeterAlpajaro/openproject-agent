# Stage 1: Build the React widget.
# Pin this stage to the build host's native architecture ($BUILDPLATFORM) so
# npm runs natively instead of under arm64 QEMU emulation (which is slow and
# intermittently crashes with "illegal instruction"). The build output is
# static JS/CSS — architecture-independent — so it is safe to compile on the
# build platform and copy into the arm64 final image.
FROM --platform=$BUILDPLATFORM node:20-alpine AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# Stage 2: Nginx with compiled assets + config baked in
FROM nginx:alpine
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/dist /usr/share/nginx/html/widget
