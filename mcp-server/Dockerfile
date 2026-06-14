FROM node:20-alpine

WORKDIR /app

# Install dependencies first to leverage Docker layer caching.
COPY package*.json ./
RUN npm install --omit=dev

# Copy the application source.
COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["node", "index.js"]
