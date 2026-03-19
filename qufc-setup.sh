#!/bin/bash
mkdir -p ~/qufc-backend
cd ~/qufc-backend

cat > package.json << 'PKG'
{
  "name": "qufc-arena-backend",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "ws": "^8.16.0"
  }
}
PKG

npm install
echo "✅ Done! Run: node server.js"
