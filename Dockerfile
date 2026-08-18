# Stage 1: Build the React client
FROM node:20-alpine AS build
WORKDIR /app/client
COPY client/package*.json ./
# NODE_ENV must NOT be 'production' yet here - npm install reads it too, and
# skips devDependencies (including vite itself!) when it's set, which is
# exactly what's needed to even run the build below. Confirmed live
# 2026-08-18: setting it this early broke `npm run build` outright with
# "vite: not found".
RUN npm install
COPY client/ ./
# Single .env for the whole app (see /.env.example) - needed here so Vite can
# inline the VITE_* build-time variables into the static bundle.
COPY .env /app/.env
# Forced regardless of whatever NODE_ENV the .env just copied in above
# carries (it's meant for local dev too, so it can legitimately say
# "development") - Vite build's own default is 'production', but that
# default can get silently overridden if a loaded .env sets NODE_ENV itself
# (see client/vite.config.js's envDir). Confirmed live 2026-08-18: the
# shared .env's NODE_ENV=development was leaking into this build, shipping
# React's *development* bundle in production - ~230KB larger, and
# React.StrictMode's dev-only double-invoking of impure functions was firing
# for real users, not just in local dev (root-caused a real bug this way:
# Splash.jsx's once-per-tab sessionStorage check never showed the splash to
# any real visitor, ever). Safe to set now - only the build step below reads
# it from here on, npm install (the step that cares about devDependencies)
# already ran above.
ENV NODE_ENV=production
RUN npm run build

# Stage 2: Setup the Node.js server
FROM node:20-alpine
WORKDIR /app
# Same reasoning as the build stage above - a production deployment must run
# as 'production' (e.g. server/authToken.js's Secure-cookie flag) regardless
# of what the shared .env says.
ENV NODE_ENV=production

# Copy server files
COPY server/package*.json ./server/
RUN cd server && npm install
COPY server/ ./server/

# Same .env again, this time for the server to read at runtime (DB/JWT/etc.)
COPY .env /app/.env

# Copy the built React app from Stage 1 into the location expected by the server
COPY --from=build /app/client/dist ./client/dist

# Expose the port the app runs on
EXPOSE 80
ENV PORT=80

# Start the server
WORKDIR /app/server
CMD ["npm", "start"]
