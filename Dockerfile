FROM node:lts-buster

# Install system dependencies (with error handling)
RUN set -x \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        imagemagick \
        webp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copy package files and install dependencies (optimized for caching)
COPY package*.json ./
RUN npm install && npm install -g qrcode-terminal pm2

# Copy the rest of the application
COPY . .

EXPOSE 5000

CMD ["npm", "start"]