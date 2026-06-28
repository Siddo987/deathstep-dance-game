# Deathstep Dance Game

## Overview

**Deathstep Dance Game** is a web‑based rhythm game where players match dance moves to the beat of intense death‑step music. The project consists of a client‑side front‑end, a server‑side back‑end, and a Docker configuration for easy deployment.

## Repository Structure

- `client/` – Front‑end source code (HTML, CSS, JavaScript).
- `server/` – Back‑end API and game logic (Node.js/Express).
- `Dockerfile` – Container definition to run the full stack.
- `README.md` – This documentation (generated in the first commit).

## Getting Started

### Prerequisites

- Docker (or Docker Desktop) installed on your machine.
- (Optional) Node.js if you want to run the client/server locally without Docker.

### Build and Run with Docker

```bash
# Build the Docker image
docker build -t deathstep-dance-game .

# Run the container
docker run -p 8080:8080 deathstep-dance-game
```

The game will be accessible at `http://localhost:8080`.

### Run Locally (without Docker)

1. **Server**
   ```bash
   cd server
   npm install
   npm start
   ```
2. **Client** (in a separate terminal)
   ```bash
   cd client
   npm install
   npm start
   ```

The client will typically be served on `http://localhost:3000` and will communicate with the server at `http://localhost:8080`.

## Contributing

Contributions are welcome! Please fork the repository, create a feature branch, and submit a pull request. Ensure code follows the existing style guidelines and that any new functionality is covered by tests.

## License

This project is licensed under the MIT License – see the `LICENSE` file for details.

---
*Generated as the initial commit to provide a comprehensive project overview.*
