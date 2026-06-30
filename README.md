# 🎵 Deathstep

**Deathstep** is an interactive, real-life social deduction party game that combines ballroom dancing with "Mafia" / "Among Us" style mechanics. Perfect for dance groups and parties, players pair up and dance while trying to uncover the hidden killers among them!

## 🎭 How to Play

1. **Pair Up**: Players connect to a game room via their smartphones and form dance couples.
2. **Secret Roles**: One couple is secretly designated as the **Killers**, while the rest are **Dancers** (Innocents).
3. **Dancing Phase**: The Game Master (GM) plays a song (integrated seamlessly with Spotify). All couples take to the dance floor!
4. **The Kill**: While dancing, the Killers must secretly eliminate another couple by subtly touching them.
5. **The Reveal**: The GM observes the floor. Once a kill occurs, the GM marks the victim. The music automatically stops, and the victim is revealed to everyone.
6. **Discussion & Voting**: The music stops, and the surviving couples discuss who they think the killers are. They then use their smartphones to cast a vote. The couple with the most votes is eliminated.
7. **Repeat**: The cycle continues until the Killers are caught, or the Killers outnumber the innocent Dancers!

## ✨ Features

- **Game Master (GM) Dashboard**: A powerful control center for the host to manage the game flow, observe players, trigger events, and manage Spotify playback.
- **Mobile-First Player Interface**: Players join the room using a 4-letter code, see their secret roles, and cast votes directly from their phones.
- **Live Spotify Integration**: The GM can search for songs and play them directly through the browser using the Spotify Web Playback SDK.
- **Dynamic Game States**: Real-time synchronization across all devices using WebSockets (Socket.io) for phases like Lobby, Pairing, Role Reveal, Dancing, Kill Reveal, Discussion, and Voting.

## 🛠️ Tech Stack

- **Frontend**: React (Vite), Socket.io-client, CSS (Cyberpunk/Neon Aesthetics)
- **Backend**: Node.js, Express, Socket.io
- **Music API**: Spotify Web Playback SDK & Spotify Web API
- **Deployment**: Dockerized for simple hosting

## 🚀 Getting Started

### Prerequisites

- Node.js (v16+)
- A Spotify Premium account (for the GM to use the Web Playback SDK)
- A registered Spotify Developer App (to get a `Client ID` for the Spotify API)

### 1. Installation

Clone the repository and install dependencies for both the server and client:

```bash
# Install Server Dependencies
cd server
npm install

# Install Client Dependencies
cd ../client
npm install
```

### 2. Environment Variables

Create a `.env` file in the `client` directory to configure your Spotify Client ID:

```env
VITE_SPOTIFY_CLIENT_ID=your_spotify_client_id_here
```

### 3. Running Locally

Start the backend server:

```bash
cd server
npm start
# Runs on http://localhost:3001
```

Start the frontend development server:

```bash
cd client
npm run dev
# Runs on http://localhost:5173
```

### 4. Docker Deployment

To build and run the full stack using Docker:

```bash
# Build the image
docker build -t deathstep-dance-game .

# Run the container
docker run -p 8080:80 deathstep-dance-game
```
The application will be accessible at `http://localhost:8080`.

## 🤝 Contributing

Contributions, bug reports, and feature requests are welcome! Feel free to open an issue or submit a pull request if you have ideas to make the game even better.

## 📄 License

This project is licensed under the MIT License.
