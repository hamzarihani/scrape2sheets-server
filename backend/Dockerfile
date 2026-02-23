# Dockerfile for Scrape2Sheets Backend

FROM node:20-slim

# Create app directory
WORKDIR /usr/src/app

# Install curl for health checks
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

RUN npm install --production

# Bundle app source
COPY . .

# Expose port
EXPOSE 4000

# Start the application
CMD [ "node", "server.js" ]
