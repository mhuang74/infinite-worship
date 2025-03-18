#!/bin/bash

echo "Starting Infinite Worship Application..."

# Start the backend server in the background
echo "Starting backend server..."
cd code/backend
./start-server.sh &
BACKEND_PID=$!

# Wait a moment for the backend to initialize
sleep 2

# Start the frontend server
echo "Starting frontend server..."
cd ../frontend
./start-dev.sh

# When the frontend server is stopped, also stop the backend
echo "Stopping backend server..."
kill $BACKEND_PID 