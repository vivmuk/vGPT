# Pull the Node.js Docker image
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the Expo web app
RUN npm run build:web

# Install 'serve' globally to serve the static files
RUN npm install -g serve

# Expose port 3000
EXPOSE 3000

# Start the application
# Railway provides the PORT environment variable
CMD ["/bin/sh", "-c", "serve -s dist -l tcp://0.0.0.0:${PORT:-3000}"]
