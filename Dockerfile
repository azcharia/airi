FROM node:18-alpine

WORKDIR /app

# Install dependencies early to use build cache
COPY package*.json ./
RUN npm install

# Copy source code
COPY src/ ./src/

CMD ["npm", "start"]