# Infinite Worship Backend API

A Flask-based API for processing audio files, detecting beats, and identifying segments for the Infinite Worship project.

## Features

- **Song Upload**: Process uploaded audio files
- **Beat Detection**: Identify beats and their characteristics
- **Segment Analysis**: Group beats into segments based on similarity
- **RESTful API**: Provide endpoints for frontend integration

## Technologies Used

- **Flask**: Lightweight web framework
- **Librosa**: Audio analysis library
- **Madmom**: Beat detection library
- **NumPy/SciPy**: Scientific computing libraries

## Getting Started

### Development Setup with Docker

This is the recommended setup for development, as it encapsulates the backend environment.

**Build the development Docker image:**
```bash
docker build -t infinite-worship-app-dev -f dockerfile-dev .
```

**Start the development Docker container:**
```bash
docker run --rm --detach -p 5001:5001 --volume $(pwd):/app --name dev infinite-worship-app-dev
```
*Note: This command maps the backend's internal port 5001 to port 5001 on the host machine. Port 5001 is used by the `application-2` frontend because recent versions of macOS run an AirPlay Receiver service on port 5001, making it unavailable for development.*

**Start the backend server inside the container:**
```bash
docker exec -it dev bash -c "cd /app && ./start-server.sh"
```

### Manual Setup

#### Prerequisites
- Python 3.8 or later
- FFmpeg (for audio processing)

### Installation

1. Clone the repository
2. Navigate to the backend directory:
   ```
   cd code/backend
   ```
3. Install dependencies:
   ```
   pip install -r requirements.txt
   ```

### Running the Server

Start the server with:

```bash
./start-server.sh
```

Or manually:

```bash
python app.py
```

The server will run on http://localhost:5001 by default.

## API Endpoints

### Upload Song

- **URL**: `/upload`
- **Method**: `POST`
- **Content-Type**: `multipart/form-data`
- **Form Data**: `file` - The audio file to upload
- **Response**: JSON object containing song segments and metadata

### Get Song Segments

- **URL**: `/segments/<song_id>`
- **Method**: `GET`
- **Response**: JSON object containing song segments and metadata

## Integration with Frontend

The backend API is designed to work with the Infinite Worship frontend. The frontend sends audio files to the `/upload` endpoint and receives segment data that it can use to visualize and control playback.

## License

This project is licensed under the Apache License 2.0 - see the LICENSE file for details. 