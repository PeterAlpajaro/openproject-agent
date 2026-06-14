FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better layer caching
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy application code
COPY . .

EXPOSE 4000

CMD ["node", "index.js"]
