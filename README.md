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

### Running with Docker

This is the recommended way to run the application, as it ensures a consistent environment.

**Build For Production:**

Currently hardcoded to build for ARM64 platform only since I use AWS graviton to lower cost (`t4g.medium` with 4GB memory and 2vCPU). Works on M2 Mac running MacOS Sequoia 15.6.
    
1.  Create and switch to a new builder instance that supports multi-platform builds.
    ```bash
    docker buildx create --name multiarch-builder --driver docker-container --use
    docker buildx inspect --bootstrap
    ```

2.  Navigate to the `application` directory:
    ```bash
    cd application
    ```

3.  Build and publish the images to AWS ECR. 
    ```bash
    ./build.sh
    ```

**Deploy For Production:**
1.  On the PROD server, install docker and docker-compose

    ```bash
    sudo apt update && sudo apt install docker.io -y && sudo apt install docker-compose -y && sudo usermod -aG docker $USER && newgrp docker
    ```

2.  Pull the latest images from my public AWS ECR repo

    ```bash
    docker pull public.ecr.aws/u4p9h6o7/mhuang74/infinite-worship:infinite-worship-backend-arm64-latest && docker pull public.ecr.aws/u4p9h6o7/mhuang74/infinite-worship:infinite-worship-frontend-arm64-latest
    ```

3.  Git clone the repo to pickup latest `docker-compose.prod.yml`

    ```bash
    git clone https://github.com/mhuang74/infinite-worship.git
    ```

4.  Bring up both frontend and backend services using docker-compose
    ```bash
    cd infinite-worship/application && docker-compose -f docker-compose.prod.yml down && docker-compose -f docker-compose.prod.yml up -d --no-build
    ```

**For Development:**

1.  Navigate to the `application` directory:
    ```
    cd application
    ```

2.  Build and run the containers:
    ```
    docker-compose -f docker-compose.dev.yml up --build
    ```
    This will start the services with hot-reloading for both the frontend and backend.

### Manual Setup

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

## Environment Variables

The project uses environment variables to configure application settings.

-   **`application/frontend/.env`**: This file is for Frontend Production settings.
-   **`application/frontend/.env.local`**: This file is for Frontend Development settings.

    -   `NEXT_PUBLIC_API_BASE_URL`: Specifies the base URL for the backend API. Defaults to `http://localhost:5001`.

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

## Setting up Cross-Platform Build (ARM64)

In order to run `build.sh` and build for ARM64, setup and use `buildx`.



2.  **Test Build:**
    Replace `YYYYMMDD` with the current date.
    ```
    docker buildx build --platform linux/arm64 -t infinite-worship-arm64 . --load
    ```


## License

This project is licensed under the Apache License 2.0 - see the LICENSE file for details.
