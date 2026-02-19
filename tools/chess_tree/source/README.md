# Chess Move Tree Generator - User Guide

## 🎯 What This Does

This tool creates a complete database of all possible chess positions up to a specified depth. Think of it as building a "map" of every possible chess game scenario.

**Perfect for:**
- Chess coaches and teachers
- Chess researchers
- Students learning chess theory
- Anyone curious about chess possibilities

## 🚀 Quick Start (No Coding Required!)

### Windows Quick Start

```bat
start.bat
```

This script will:
- Defer to `start.py` (see below) with all the same options
- Launch the visualization server and open your browser

### Cross-Platform Quick Start

```bash
python start.py
```

This Python helper is tuned for fast feedback:
- Installs the binary on demand (or use `--skip-install` / `--force-install`)
- Seeds a fresh database at depth 0 by default for near-instant start (`--depth N` to choose another depth)
- Streams server logs with step-by-step timing so you know exactly when the binary, database and server are ready
- Keeps the generator running in the background for deeper depths while the server comes online immediately
- Opens your browser automatically (suppress with `--no-browser`)

### Option 1: One-Click Installation (Recommended)

**Windows:**
1. Download `chess-tree-setup.exe` from releases
2. Double-click to install
3. Follow the setup wizard

**Mac:**
1. Download `chess-tree-setup.dmg` from releases
2. Open and drag to Applications
3. Run from Applications folder

**Linux:**
1. Download `chess-tree-setup.AppImage`
2. Make executable: `chmod +x chess-tree-setup.AppImage`
3. Double-click to run

### Option 2: Manual Installation

1. **Download Stockfish** (required for evaluation):
   - Windows: Download from https://stockfishchess.org/download/
   - Mac: `brew install stockfish`
   - Linux: `sudo apt install stockfish`

2. **Install the tool**:
   ```bash
   # Windows (PowerShell)
   winget install chess-move-tree
   
   # Mac
   brew install chess-move-tree
   
   # Linux
   sudo apt install chess-move-tree
   ```

## 📋 Step-by-Step Usage

### 1. First Time Setup

**Using the Setup Wizard:**
```bash
# Run the setup wizard
chess-tree-setup

# Or if installed via package manager
chess-tree --setup
```

The wizard will:
- Detect Stockfish automatically
- Set optimal settings for your computer
- Create your first configuration

### 2. Basic Usage

**Generate a small tree (good for learning):**
```bash
chess-tree --depth 3
```

**Generate a deeper tree (takes longer):**
```bash
chess-tree --depth 6
```

**Resume from where you left off:**
```bash
chess-tree --resume
```

**Extend an existing tree:**
```bash
chess-tree --extend 2
```

### 3. View Results

After generation, start the web interface:
```bash
chess-tree --serve
```

Then open your browser to: **http://localhost:8080**

### Monitoring & Telemetry

- Observe live health data at **http://localhost:8080/api/metrics** (JSON payload with database latency, cache hit rate, and throughput)
- Watch the launcher output for per-step timings (`Binary ready in …`, `Database primed in …`, `Server online in …`)
- Combine the `/api/metrics` endpoint with your favourite dashboard (Prometheus/Grafana, Datadog, etc.) by polling on an interval

## 🎮 Web Interface Guide

### Navigation
- **Click any position** to see the chess board—selections no longer re-render the whole tree, so the UI stays snappy
- **Use arrow keys** to navigate the tree
- **Search box** (debounced) finds positions by FEN or move sequence without spamming the backend
- **Expand/Collapse buttons** now stream child nodes in chunks, keeping scrolling responsive even for large branches

### Understanding the Display
- **Green numbers**: Good for White
- **Red numbers**: Good for Black
- **Board**: Shows current position
- **Move sequence**: Shows how to reach this position

## ⚙️ Configuration Made Simple

### Using the Configuration File

Create a file called `chess-tree.toml` in your project folder:

```toml
# Simple configuration for beginners
[generation]
max_depth = 4  # Start small - 4 moves deep
threads = 0    # Auto-detect CPU cores
buffer_size = 500

[storage]
path = "my_chess_tree.db"

[evaluation]
enabled = true
stockfish_path = "stockfish"  # Will auto-detect

[server]
port = 8080
enabled = true
```

### Preset Configurations

**Light Mode** (quick demo):
```toml
max_depth = 3
threads = 2
buffer_size = 100
```

**Standard Mode** (good balance):
```toml
max_depth = 6
threads = 4
buffer_size = 1000
```

**Deep Mode** (research):
```toml
max_depth = 10
threads = 8
buffer_size = 5000
```

## 🔧 Troubleshooting

### Common Issues

**"Stockfish not found"**
- Solution: Install Stockfish or use `--stockfish-path /path/to/stockfish`

**"Out of memory"**
- Solution: Reduce depth or use `--buffer-size 100`

**"Database locked"**
- Solution: Close other programs using the database

**"Slow generation"**
- Solution: Increase threads: `--threads 8`

### Getting Help

1. **Check the logs**: Look for `chess-tree.log` in your folder
2. **Run diagnostics**: `chess-tree --diagnose`
3. **Community support**: Visit our GitHub discussions

## 📊 Understanding Your Results

### What the Numbers Mean

- **Evaluation**: +1.00 means White is winning by 1 pawn
- **Depth**: How many moves ahead the analysis goes
- **Positions**: Total unique positions found

### Example Output
```
[Progress] Expanded: 10,000 | Inserted: 8,500 | Duplicates: 1,500
Memory: 45.2MB | Rate: 250 positions/sec
```

## 🎯 Practical Examples

### For Teachers
```bash
# Create a small tree for classroom use
chess-tree --depth 3 --config classroom.toml
```

### For Researchers
```bash
# Deep analysis with evaluation
chess-tree --depth 8 --threads 8 --enable-evaluation
```

### For Casual Users
```bash
# Quick demo with web interface
chess-tree --depth 4 --serve
```

## 📱 Mobile Friendly

The web interface works on phones and tablets:
- Touch-friendly controls
- Responsive design
- Works offline after generation

## 🆘 Need More Help?

- **Video tutorials**: Check our YouTube channel
- **Discord community**: Join our server
- **Email support**: support@chess-tree.com

## 🎓 Learning Resources

### Beginner Articles
- [Understanding Chess Trees](docs/beginner-guide.md)
- [How to Read Position Evaluations](docs/evaluations.md)
- [Using the Web Interface](docs/web-interface.md)

### Advanced Topics
- [Memory Optimization](docs/memory-guide.md)
- [Custom Configurations](docs/advanced-config.md)
- [Database Management](docs/database.md)

---

**Ready to start?** Run `chess-tree --help` for all options!

