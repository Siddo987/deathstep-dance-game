# 🎵 Deathstep

**Deathstep** is an interactive, real-life social deduction party game that combines ballroom dancing with "Mafia" / "Among Us" style mechanics. Perfect for dance groups and parties, players pair up and dance while trying to uncover the hidden killers among them!

## 🎭 How to Play

1. **Pair Up**: Players connect to a game room via their smartphones and form dance couples.
2. **Secret Roles**: One couple is secretly designated as the **Killers** (can be multiple couples), while the rest are **Dancers** (Innocents).
3. **Dancing Phase**: The Game Master (GM) plays a song (integrated seamlessly with Spotify). All couples take to the dance floor!
4. **The Kill**: While dancing, the Killers must secretly eliminate another couple by subtly touching them.
5. **The Reveal**: The GM observes the floor (can be multiple GMs). Once a kill occurs, the GM marks the victim. The music automatically stops, and the victim is revealed to everyone.
6. **Discussion & Voting**: The music stops, and the surviving couples discuss who they think the killers are. They then use their smartphones to cast a vote. The couple with the most votes is eliminated.
7. **Repeat**: The cycle continues until the Killers are caught, or the Killers outnumber the innocent Dancers!

## ✨ Features

- **Game Master (GM) Dashboard**: A powerful control center for the host to manage the game flow, observe players, trigger events, and manage Spotify playback.
- **Mobile-First Player Interface**: Players join the room using a 4-digit code, see their secret roles, and cast votes directly from their phones.
- **Live Spotify Integration**: The GM can search for songs, queue one of their own playlists, and play them directly through the browser using the Spotify Web Playback SDK.
- **Dynamic Game States**: Real-time synchronization across all devices using WebSockets (Socket.io) for phases like Lobby, Pairing, Role Reveal, Dancing, Kill Reveal, Discussion, and Voting.
- **Player Song Suggestions**: Players can suggest a track to the GM at any time - either a real Spotify track (searched, or picked from their own imported playlists) or a plain-text hint if they have no Spotify connected.
- **Optional Accounts**: Email/password or Google Sign-In accounts (requires the optional MariaDB setup below) unlock a default dance-role/name for faster joining, personal win/loss stats, an opt-in public leaderboard, and Spotify account linking.
- **Live-Synced Playlists**: A logged-in account can import a Spotify playlist into the app; new tracks added or removed on either side are staged and reconciled automatically once confirmed (see `server/playlists.js`).

## 🛠️ Tech Stack

- **Frontend**: React (Vite), Socket.io-client, CSS (Cyberpunk/Neon Aesthetics)
- **Backend**: Node.js, Express, Socket.io
- **Accounts** (optional): MariaDB, JWT session cookies, bcrypt, Google Sign-In
- **Music API**: Spotify Web Playback SDK & Spotify Web API
- **Deployment**: Dockerized for simple hosting

## 🚀 Getting Started

### Prerequisites

- Node.js (v16+)
- A Spotify Premium account (for the GM to use the Web Playback SDK)
- A registered Spotify Developer App (to get a `Client ID` for the Spotify API)
- Optional: a MariaDB server, to enable accounts/stats/leaderboard/playlists (the core game works without it - see `.env.example`)

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

Copy `.env.example` to `.env` in the **repository root** (not in `client/` or `server/` - both the client build and the server read from this single file) and fill in your values:

```bash
cp .env.example .env
```

At minimum, set your Spotify Client ID. Login/accounts (MariaDB + optional Google Sign-In) are optional - see the comments in `.env.example` for those variables.

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

This project is licensed under the [GNU General Public License v3.0](LICENSE).
