# Infinite Worship

A modern application for infinite playback of worship songs through intelligent remixing.

## Overview

Infinite Worship analyzes audio files to identify beats and segments, then creates intelligent remixes that can play indefinitely while maintaining musical coherence. The system uses advanced audio processing techniques to find similar sections of a song and create seamless transitions between them.

## Features

- **Song Upload**: Upload MP3, WAV, or OGG files for processing
- **Beat Detection**: Automatically detect beats and their musical characteristics
- **Segment Analysis**: Group similar beats into segments based on harmonic and rhythmic patterns
- **Visualization**: See song segments color-coded by similarity
- **Intelligent Playback**: Experience seamless transitions between similar segments
- **Progress Tracking**: Monitor current segment, next jump, and beats until jump

## Project Structure

- **Frontend**: A Next.js web application with audio visualization and playback controls
- **Backend**: A Flask API that processes audio files and identifies segments
- **Exploration**: Notebooks and reference code for audio analysis techniques

## Getting Started

### Prerequisites

- Node.js 18.17 or later (for frontend)
- Python 3.8 or later (for backend)
- FFmpeg (for audio processing)

### Running the Frontend

1. Navigate to the frontend directory:
   ```
   cd application/frontend
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Start the development server:
   ```
   ./start-dev.sh
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

### Running the Backend

1. Navigate to the backend directory:
   ```
   cd application/backend
   ```

2. Install dependencies:
   ```
   pip install -r requirements.txt
   ```

3. Start the server:
   ```
   ./start-server.sh
   ```

The backend API will be available at [http://localhost:5001](http://localhost:5001)

## How It Works

1. **Audio Analysis**: The system analyzes the audio file to identify beats and their characteristics
2. **Clustering**: Similar beats are grouped into clusters based on harmonic and rhythmic features
3. **Segmentation**: Contiguous beats in the same cluster are grouped into segments
4. **Jump Candidates**: For each beat, the system identifies potential "jump points" to other similar beats
5. **Playback**: During playback, the system can seamlessly transition between similar segments

## Technologies Used

- **Next.js**: React framework for the frontend
- **TypeScript**: Type-safe JavaScript
- **Tailwind CSS**: Utility-first CSS framework
- **WaveSurfer.js**: Audio visualization
- **Flask**: Python web framework for the backend
- **Librosa**: Audio analysis library
- **Madmom**: Beat detection library

## License

This project is licensed under the Apache License 2.0 - see the LICENSE file for details.
