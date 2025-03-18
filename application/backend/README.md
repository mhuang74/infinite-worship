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

### Prerequisites

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

The server will run on http://localhost:5000 by default.

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