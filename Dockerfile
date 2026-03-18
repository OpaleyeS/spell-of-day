# Use official Node image
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy package files first (better caching)
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy rest of the app
COPY . .

# Expose port (Fly uses 8080 by default)
ENV PORT=8080
EXPOSE 8080

# Start the app
CMD ["node", "server/server.js"]
