FROM node:22-alpine

WORKDIR /app

ENV PORT=4000 \
    S3_ENDPOINT=127.0.0.1 \
    S3_PORT=9000 \
    S3_SSL=false \
    S3_BUCKET=test-attributions \
    S3_ACCESS_KEY=minioadmin \
    S3_SECRET_KEY=minioadmin

COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 4000
CMD ["npm", "start"]
