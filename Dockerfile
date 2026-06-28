# Stage 1: Build the React client
FROM node:20-alpine AS build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# Stage 2: Setup the Node.js server
FROM node:20-alpine
WORKDIR /app

# Copy server files
COPY server/package*.json ./server/
RUN cd server && npm install
COPY server/ ./server/

# Copy the built React app from Stage 1 into the location expected by the server
COPY --from=build /app/client/dist ./client/dist

# Expose the port the app runs on
EXPOSE 80
ENV PORT=80

# Start the server
WORKDIR /app/server
CMD ["npm", "start"]
